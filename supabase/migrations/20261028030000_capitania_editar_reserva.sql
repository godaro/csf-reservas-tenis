-- =====================================================================
-- Capitanía: modificar una reserva desde el panel
--   * Cambiar de cancha (mismo horario), por ejemplo por un mantenimiento.
--   * Reemplazar a un jugador (por ejemplo, si se lesionó). El que entra
--     tiene que cumplir las mismas reglas que al reservar: carnet vigente,
--     máximo de reservas activas y separación mínima con sus otras reservas.
--   * Avisos por mail: el que entra recibe la confirmación, el que sale
--     recibe que ya no juega y los demás, el cambio.
-- Se corre en Supabase → SQL Editor. Después hay que volver a desplegar la
-- Edge Function "enviar-avisos" con el index.ts nuevo (textos de los mails).
-- =====================================================================

alter table public.reservas add column if not exists modificada timestamptz;
alter table public.reservas add column if not exists modificada_por text references public.socios (nro);

-- Avisos: dos tipos nuevos y un texto que explica el cambio
alter table public.avisos add column if not exists detalle text;
do $$
declare c text;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.avisos'::regclass and contype in ('c', 'u')
              and (pg_get_constraintdef(oid) ilike '%tipo%')
  loop
    execute format('alter table public.avisos drop constraint %I', c);
  end loop;
end $$;
alter table public.avisos add constraint avisos_tipo_check
  check (tipo in ('confirmada', 'cancelada', 'modificada', 'quitado'));
-- Una confirmación y una cancelación por jugador y reserva; los cambios pueden ser varios
create unique index if not exists avisos_unico_idx on public.avisos (tipo, reserva_id, socio_nro)
  where tipo in ('confirmada', 'cancelada', 'quitado');

create or replace function public._encolar_confirmacion() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.avisos (tipo, reserva_id, socio_nro, estado)
  select 'confirmada', new.reserva_id, new.socio_nro,
         case when public._email_valido(s.email) then 'pendiente' else 'sin_mail' end
  from public.socios s
  join public.reservas r on r.id = new.reserva_id
  where s.nro = new.socio_nro
    and r.estado = 'activa' and r.fin > now()
  on conflict (tipo, reserva_id, socio_nro) where tipo in ('confirmada', 'cancelada', 'quitado') do nothing;
  return new;
exception when others then
  raise warning '_encolar_confirmacion: %', sqlerrm;
  return new;
end $$;

create or replace function public._encolar_cancelacion() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.estado = 'activa' and new.estado = 'cancelada' and new.fin > now() then
    update public.avisos set estado = 'descartado'
     where reserva_id = new.id and tipo in ('confirmada', 'modificada') and estado = 'pendiente';

    insert into public.avisos (tipo, reserva_id, socio_nro, estado)
    select 'cancelada', new.id, rj.socio_nro,
           case when public._email_valido(s.email) then 'pendiente' else 'sin_mail' end
    from public.reserva_jugadores rj
    join public.socios s on s.nro = rj.socio_nro
    where rj.reserva_id = new.id
    on conflict (tipo, reserva_id, socio_nro) where tipo in ('confirmada', 'cancelada', 'quitado') do nothing;
  end if;
  return new;
exception when others then
  raise warning '_encolar_cancelacion: %', sqlerrm;
  return new;
end $$;

-- Encola un aviso de cambio (para un socio) con su texto
create or replace function public._encolar_cambio(p_reserva uuid, p_socio text, p_tipo text, p_detalle text) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  insert into public.avisos (tipo, reserva_id, socio_nro, estado, detalle)
  select p_tipo, p_reserva, s.nro,
         case when public._email_valido(s.email) then 'pendiente' else 'sin_mail' end, p_detalle
  from public.socios s where s.nro = p_socio
  on conflict (tipo, reserva_id, socio_nro) where tipo in ('confirmada', 'cancelada', 'quitado')
  do update set estado = excluded.estado, detalle = excluded.detalle, intentos = 0, error = null, creado = now();
exception when others then
  raise warning '_encolar_cambio: %', sqlerrm;
end $$;

-- Lo que la Edge Function necesita para armar cada mail (suma "detalle")
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
    'detalle', t.detalle,
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
    'yo_cancele', r.cancelada_por is not distinct from t.socio_nro,
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

-- ---------------------------------------------------------------------
-- API del panel
-- ---------------------------------------------------------------------
-- Detalle de una reserva + canchas libres en ese mismo horario
create or replace function public.capitania_reserva(p_token uuid, p_id uuid) returns json
language plpgsql stable security definer set search_path = public as $$
declare
  s public.socios := public._exigir_capitania(p_token);
  r public.reservas;
  z text := (select zona from public.config limit 1);
begin
  select * into r from public.reservas where id = p_id;
  if not found then raise exception 'No encontramos esa reserva.'; end if;
  return json_build_object(
    'id', r.id, 'estado', r.estado, 'cancha', r.cancha_id, 'tipo', r.tipo,
    'inicio', r.inicio, 'fin', r.fin,
    'fecha', (r.inicio at time zone z)::date,
    'hora_inicio', to_char(r.inicio at time zone z, 'HH24:MI'),
    'hora_fin', to_char(r.fin at time zone z, 'HH24:MI'),
    'pasada', r.fin <= now(),
    'modificada', r.modificada,
    'modificada_por', (select public._nombre(x) from public.socios x where x.nro = r.modificada_por),
    'jugadores', (select json_agg(json_build_object('nro', o.nro, 'nombre', public._nombre(o), 'titular', rj.es_titular)
                                  order by rj.es_titular desc, o.apellido)
                    from public.reserva_jugadores rj join public.socios o on o.nro = rj.socio_nro
                   where rj.reserva_id = r.id),
    'canchas_libres', coalesce((select json_agg(c.id order by c.id) from public.canchas c
                                 where c.id <> r.cancha_id and public._ocupada(c.id, r.inicio, r.fin) is null), '[]'::json)
  );
end $$;

create or replace function public.capitania_mover_cancha(p_token uuid, p_id uuid, p_cancha int, p_motivo text default null)
returns json
language plpgsql volatile security definer set search_path = public as $$
declare
  s public.socios := public._exigir_capitania(p_token);
  r public.reservas;
  m text;
  det text;
  j record;
begin
  select * into r from public.reservas where id = p_id for update;
  if not found or r.estado <> 'activa' then raise exception 'Esa reserva ya no está activa.'; end if;
  if r.fin <= now() then raise exception 'Ese partido ya terminó.'; end if;
  if p_cancha = r.cancha_id then raise exception 'La reserva ya está en la cancha %.', p_cancha; end if;
  m := public._ocupada(p_cancha, r.inicio, r.fin);
  if m is not null then
    raise exception 'La cancha % no está libre en ese horario (%).', p_cancha, lower(m) using hint = 'OCUPADA';
  end if;

  begin
    update public.reservas set cancha_id = p_cancha, modificada = now(), modificada_por = s.nro where id = p_id;
  exception when exclusion_violation then
    raise exception 'La cancha % se acaba de ocupar. Elegí otra.', p_cancha using hint = 'OCUPADA';
  end;

  det := format('La Capitanía de Tenis pasó tu partido de la cancha %s a la cancha %s%s.',
                r.cancha_id, p_cancha,
                case when nullif(trim(coalesce(p_motivo, '')), '') is not null then ' (' || trim(p_motivo) || ')' else '' end);
  for j in select socio_nro from public.reserva_jugadores where reserva_id = p_id loop
    perform public._encolar_cambio(p_id, j.socio_nro, 'modificada', det);
  end loop;
  return json_build_object('cancha_anterior', r.cancha_id, 'cancha', p_cancha);
end $$;

create or replace function public.capitania_reemplazar_jugador(p_token uuid, p_id uuid, p_sale text, p_entra text, p_motivo text default null)
returns json
language plpgsql volatile security definer set search_path = public as $$
declare
  s public.socios := public._exigir_capitania(p_token);
  r public.reservas;
  sale public.socios;
  entra public.socios;
  era_titular boolean;
  impide text;
  c public.config := public._cfg();
  mot text := nullif(trim(coalesce(p_motivo, '')), '');
  j record;
begin
  select * into r from public.reservas where id = p_id for update;
  if not found or r.estado <> 'activa' then raise exception 'Esa reserva ya no está activa.'; end if;
  if r.fin <= now() then raise exception 'Ese partido ya terminó.'; end if;

  select rj.es_titular into era_titular from public.reserva_jugadores rj where rj.reserva_id = p_id and rj.socio_nro = p_sale;
  if not found then raise exception 'Ese jugador no está en la reserva.'; end if;
  select * into sale from public.socios where nro = p_sale;

  perform pg_advisory_xact_lock(hashtext('socio:' || p_entra));
  select * into entra from public.socios where nro = p_entra;
  if not found then raise exception 'No encontramos al socio %.', p_entra; end if;
  if exists (select 1 from public.reserva_jugadores where reserva_id = p_id and socio_nro = p_entra) then
    raise exception '% ya está en este partido.', public._nombre(entra);
  end if;
  if not public._carnet_ok(entra) then
    raise exception '% no tiene carnet de tenis vigente.', public._nombre(entra);
  end if;
  impide := public._impide_reservar(p_entra, r.inicio, r.fin);
  if impide = 'limite' then
    raise exception '% ya tiene % reservas activas, el máximo.', public._nombre(entra), c.max_reservas;
  elsif impide = 'cerca' then
    raise exception '% tiene otra reserva muy cerca de ese horario (a menos de %).', public._nombre(entra), public._texto_minutos(c.separacion_min);
  end if;

  delete from public.reserva_jugadores where reserva_id = p_id and socio_nro = p_sale;
  insert into public.reserva_jugadores (reserva_id, socio_nro, es_titular) values (p_id, p_entra, era_titular);
  update public.reservas
     set titular_nro = case when era_titular then p_entra else titular_nro end,
         modificada = now(), modificada_por = s.nro
   where id = p_id;

  -- Avisos (al que sale ya no le mandamos lo que tenía pendiente de este partido)
  update public.avisos set estado = 'descartado'
   where reserva_id = p_id and socio_nro = p_sale and tipo in ('confirmada', 'modificada') and estado = 'pendiente';
  perform public._encolar_cambio(p_id, p_sale, 'quitado',
    format('La Capitanía de Tenis te sacó de este partido%s. Tu lugar lo ocupa %s.',
           case when mot is not null then ' (' || mot || ')' else '' end, public._nombre(entra)));
  update public.avisos set detalle = format('La Capitanía de Tenis te sumó a este partido en lugar de %s.', public._nombre(sale))
   where reserva_id = p_id and socio_nro = p_entra and tipo = 'confirmada';
  for j in select socio_nro from public.reserva_jugadores where reserva_id = p_id and socio_nro <> p_entra loop
    perform public._encolar_cambio(p_id, j.socio_nro, 'modificada',
      format('La Capitanía de Tenis cambió un jugador de tu partido: sale %s y entra %s%s.',
             public._nombre(sale), public._nombre(entra),
             case when mot is not null then ' (' || mot || ')' else '' end));
  end loop;

  return json_build_object('sale', public._nombre(sale), 'entra', public._nombre(entra));
end $$;

revoke all on function public._encolar_cambio(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.avisos_tomar(int) from public, anon, authenticated;
grant execute on function public.avisos_tomar(int) to service_role;
revoke all on function public.capitania_reserva(uuid, uuid) from public;
revoke all on function public.capitania_mover_cancha(uuid, uuid, int, text) from public;
revoke all on function public.capitania_reemplazar_jugador(uuid, uuid, text, text, text) from public;
grant execute on function public.capitania_reserva(uuid, uuid) to anon, authenticated;
grant execute on function public.capitania_mover_cancha(uuid, uuid, int, text) to anon, authenticated;
grant execute on function public.capitania_reemplazar_jugador(uuid, uuid, text, text, text) to anon, authenticated;

notify pgrst, 'reload schema';
