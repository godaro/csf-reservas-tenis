-- =====================================================================
-- Avisos por mail (desde web@clubsanfernando.org.ar)
--
-- Cómo funciona:
--   1. Cada vez que se confirma o se cancela una reserva, la base anota un
--      aviso por jugador en la tabla "avisos" (una "bandeja de salida").
--   2. Enseguida "despierta" a la función enviar-avisos (Supabase Edge
--      Function), que toma los pendientes y los manda por SMTP.
--   3. Cada 5 minutos se vuelve a despertar, para reintentar lo que haya
--      fallado (hasta 5 intentos por aviso).
-- Si el mail falla, la reserva NO se ve afectada: el aviso queda pendiente.
--
-- Se corre en Supabase → SQL Editor (después de las migraciones anteriores).
-- =====================================================================

create extension if not exists pg_net with schema extensions;

-- ---------------------------------------------------------------------
-- Configuración privada (no accesible desde la web)
-- ---------------------------------------------------------------------
create table if not exists public.config_privada (
  clave text primary key,
  valor text not null
);
alter table public.config_privada enable row level security;
revoke all on public.config_privada from anon, authenticated;

insert into public.config_privada (clave, valor) values
  ('avisos_url',   'https://ainnkcqhsxgmzrnkahqv.supabase.co/functions/v1/enviar-avisos'),
  ('avisos_clave', encode(extensions.gen_random_bytes(24), 'hex'))
on conflict (clave) do nothing;

-- ---------------------------------------------------------------------
-- Bandeja de salida
-- ---------------------------------------------------------------------
create table if not exists public.avisos (
  id          bigint generated always as identity primary key,
  tipo        text not null check (tipo in ('confirmada', 'cancelada')),
  reserva_id  uuid not null references public.reservas (id) on delete cascade,
  socio_nro   text not null references public.socios (nro),
  estado      text not null default 'pendiente'
              check (estado in ('pendiente', 'enviando', 'enviado', 'error', 'sin_mail', 'descartado')),
  intentos    int  not null default 0,
  tomado      timestamptz,
  error       text,
  creado      timestamptz not null default now(),
  enviado     timestamptz,
  unique (tipo, reserva_id, socio_nro)
);
create index if not exists avisos_pendientes_idx on public.avisos (estado) where estado in ('pendiente', 'enviando');
alter table public.avisos enable row level security;
revoke all on public.avisos from anon, authenticated;

-- ---------------------------------------------------------------------
-- Despertar a la función de envío (asincrónico: sale después del commit)
-- ---------------------------------------------------------------------
create or replace function public.despertar_envios() returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  u text := (select valor from public.config_privada where clave = 'avisos_url');
  k text := (select valor from public.config_privada where clave = 'avisos_clave');
begin
  if u is null or not exists (select 1 from pg_extension where extname = 'pg_net') then
    return;
  end if;
  if not exists (select 1 from public.avisos where estado in ('pendiente', 'enviando')) then
    return;
  end if;
  perform net.http_post(
    url := u,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-avisos-clave', k),
    body := '{}'::jsonb
  );
exception when others then
  -- Nunca romper una reserva por un problema con los avisos
  raise warning 'despertar_envios: %', sqlerrm;
end $$;

create or replace function public._despertar_envios_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.despertar_envios();
  return null;
end $$;

drop trigger if exists avisos_despertar on public.avisos;
create trigger avisos_despertar
  after insert on public.avisos
  for each statement execute function public._despertar_envios_trigger();

-- ---------------------------------------------------------------------
-- Encolar avisos
-- ---------------------------------------------------------------------
-- Confirmación: a cada jugador que se suma a una reserva (titular incluido)
create or replace function public._encolar_confirmacion() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.avisos (tipo, reserva_id, socio_nro, estado)
  select 'confirmada', new.reserva_id, new.socio_nro,
         case when coalesce(trim(s.email), '') = '' then 'sin_mail' else 'pendiente' end
  from public.socios s
  join public.reservas r on r.id = new.reserva_id
  where s.nro = new.socio_nro
    and r.estado = 'activa' and r.fin > now()
  on conflict do nothing;
  return new;
exception when others then
  raise warning '_encolar_confirmacion: %', sqlerrm;
  return new;
end $$;

drop trigger if exists reserva_jugadores_aviso on public.reserva_jugadores;
create trigger reserva_jugadores_aviso
  after insert on public.reserva_jugadores
  for each row execute function public._encolar_confirmacion();

-- Cancelación: a todos los jugadores menos a quien canceló
create or replace function public._encolar_cancelacion() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.estado = 'activa' and new.estado = 'cancelada' and new.fin > now() then
    -- Si la confirmación todavía no salió, ya no tiene sentido mandarla
    update public.avisos set estado = 'descartado'
     where reserva_id = new.id and tipo = 'confirmada' and estado = 'pendiente';

    insert into public.avisos (tipo, reserva_id, socio_nro, estado)
    select 'cancelada', new.id, rj.socio_nro,
           case when coalesce(trim(s.email), '') = '' then 'sin_mail' else 'pendiente' end
    from public.reserva_jugadores rj
    join public.socios s on s.nro = rj.socio_nro
    where rj.reserva_id = new.id
      and rj.socio_nro is distinct from new.cancelada_por
    on conflict do nothing;
  end if;
  return new;
exception when others then
  raise warning '_encolar_cancelacion: %', sqlerrm;
  return new;
end $$;

drop trigger if exists reservas_aviso_cancelacion on public.reservas;
create trigger reservas_aviso_cancelacion
  after update of estado on public.reservas
  for each row execute function public._encolar_cancelacion();

-- ---------------------------------------------------------------------
-- API para la función de envío (solo service_role, nunca la web)
-- ---------------------------------------------------------------------
-- Toma hasta p_limite avisos pendientes (sin que dos envíos agarren el mismo)
create or replace function public.avisos_tomar(p_limite int default 20) returns json
language plpgsql volatile security definer set search_path = public as $$
declare
  z text := (select zona from public.config limit 1);
  res json;
begin
  with elegidos as (
    select a.id from public.avisos a
    where (a.estado = 'pendiente' or (a.estado = 'enviando' and a.tomado < now() - interval '10 minutes'))
      and a.intentos < 5
    order by a.id
    limit p_limite
    for update skip locked
  ), tomados as (
    update public.avisos a
       set estado = 'enviando', intentos = a.intentos + 1, tomado = now()
      from elegidos e
     where a.id = e.id
    returning a.*
  )
  select coalesce(json_agg(json_build_object(
    'id', t.id,
    'tipo', t.tipo,
    'email', trim(s.email),
    'nombre', s.nombre,
    'reserva_id', r.id,
    'estado_reserva', r.estado,
    'cancha', r.cancha_id,
    'tipo_partido', r.tipo,
    'inicio', r.inicio,
    'fin', r.fin,
    'fecha', (r.inicio at time zone z)::date,
    'hora_inicio', to_char(r.inicio at time zone z, 'HH24:MI'),
    'hora_fin', to_char(r.fin at time zone z, 'HH24:MI'),
    'es_titular', r.titular_nro = t.socio_nro,
    'titular', (select public._nombre(x) from public.socios x where x.nro = r.titular_nro),
    'otros', (select json_agg(public._nombre(o) order by rj.es_titular desc, o.apellido)
                from public.reserva_jugadores rj join public.socios o on o.nro = rj.socio_nro
               where rj.reserva_id = r.id and rj.socio_nro <> t.socio_nro),
    'cancelada_por_capitania', coalesce(cp.rol = 'capitania', false),
    'cancelo', case when cp.nro is not null then public._nombre(cp) end,
    'motivo', r.motivo_cancelacion
  ) order by t.id), '[]'::json) into res
  from tomados t
  join public.socios s on s.nro = t.socio_nro
  join public.reservas r on r.id = t.reserva_id
  left join public.socios cp on cp.nro = r.cancelada_por;
  return res;
end $$;

-- Resultado de cada envío: 'enviado', 'descartado' o 'fallo'
create or replace function public.avisos_resultado(p_id bigint, p_resultado text, p_error text default null) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  update public.avisos
     set estado = case p_resultado
                    when 'enviado' then 'enviado'
                    when 'descartado' then 'descartado'
                    else case when intentos >= 5 then 'error' else 'pendiente' end
                  end,
         enviado = case when p_resultado = 'enviado' then now() end,
         error = left(p_error, 500)
   where id = p_id;
end $$;

revoke all on function public.despertar_envios() from public, anon, authenticated;
revoke all on function public._despertar_envios_trigger() from public, anon, authenticated;
revoke all on function public._encolar_confirmacion() from public, anon, authenticated;
revoke all on function public._encolar_cancelacion() from public, anon, authenticated;
revoke all on function public.avisos_tomar(int) from public, anon, authenticated;
revoke all on function public.avisos_resultado(bigint, text, text) from public, anon, authenticated;
grant execute on function public.avisos_tomar(int) to service_role;
grant execute on function public.avisos_resultado(bigint, text, text) to service_role;

-- ---------------------------------------------------------------------
-- Reintentos cada 5 minutos (pg_cron)
-- ---------------------------------------------------------------------
do $$
begin
  create extension if not exists pg_cron;
  begin
    perform cron.unschedule('enviar-avisos');
  exception when others then null;
  end;
  perform cron.schedule('enviar-avisos', '*/5 * * * *', 'select public.despertar_envios()');
exception when others then
  raise notice 'pg_cron no disponible (%): los avisos salen igual al momento, pero sin reintentos automáticos.', sqlerrm;
end $$;

-- Para ver la clave que hay que cargar en la función (Edge Functions → Secrets → AVISOS_CLAVE):
--   select valor from public.config_privada where clave = 'avisos_clave';
-- Para ver cómo van los avisos:
--   select a.id, a.tipo, a.socio_nro, a.estado, a.intentos, a.error, a.creado from public.avisos a order by a.id desc limit 50;
