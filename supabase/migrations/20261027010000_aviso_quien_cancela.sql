-- =====================================================================
-- El aviso de cancelación también le llega a quien canceló (como constancia
-- y para que borre el partido de su calendario), con un texto propio.
-- Se corre en Supabase → SQL Editor. Después hay que volver a publicar la
-- función enviar-avisos con el código nuevo.
-- =====================================================================

-- Cancelación: a todos los jugadores, incluido quien canceló
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
    on conflict do nothing;
  end if;
  return new;
exception when others then
  raise warning '_encolar_cancelacion: %', sqlerrm;
  return new;
end $$;

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

revoke all on function public.avisos_tomar(int) from public, anon, authenticated;
grant execute on function public.avisos_tomar(int) to service_role;
