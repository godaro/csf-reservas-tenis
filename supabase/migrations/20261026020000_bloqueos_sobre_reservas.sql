-- =====================================================================
-- Bloqueos que pisan reservas existentes.
-- Antes: el bloqueo se creaba y la reserva quedaba activa (el socio creía
-- tener cancha). Ahora:
--   1. previsualizar_bloqueo() lista las reservas que se verían afectadas;
--   2. crear_bloqueo() se niega si hay reservas afectadas, salvo que la
--      Capitanía confirme cancelarlas: bloqueo + cancelación en un solo paso;
--   3. el socio ve en "Mis reservas" que se la canceló la Capitanía y por qué.
-- Los bloqueos semanales revisan todas las reservas futuras de ese día de semana.
-- Se corre en Supabase → SQL Editor.
-- =====================================================================

alter table public.reservas add column if not exists motivo_cancelacion text;

-- Reservas activas (por jugar) que pisaría un bloqueo
create or replace function public._reservas_afectadas(
  p_canchas int[], p_fecha date, p_desde time, p_hasta time, p_semanal boolean
) returns setof public.reservas
language sql stable security definer set search_path = public as $$
  select r.* from public.reservas r, public.config c
  where r.estado = 'activa'
    and r.fin > now()
    and r.cancha_id = any (p_canchas)
    and case
      when p_semanal then
        extract(dow from (r.inicio at time zone c.zona))::int = extract(dow from p_fecha)::int
        and (r.inicio at time zone c.zona)::date >= p_fecha
        and (r.inicio at time zone c.zona)::time < p_hasta
        and (r.fin    at time zone c.zona)::time > p_desde
      else
        tstzrange(r.inicio, r.fin) && tstzrange(public._instante(p_fecha, p_desde), public._instante(p_fecha, p_hasta))
    end;
$$;

create or replace function public._reserva_json(r public.reservas) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'id', r.id,
    'cancha', r.cancha_id,
    'fecha', (r.inicio at time zone c.zona)::date,
    'hora_inicio', to_char(r.inicio at time zone c.zona, 'HH24:MI'),
    'hora_fin', to_char(r.fin at time zone c.zona, 'HH24:MI'),
    'jugadores', (select string_agg(public._nombre(o), ', ' order by rj.es_titular desc, o.apellido)
                    from public.reserva_jugadores rj join public.socios o on o.nro = rj.socio_nro
                   where rj.reserva_id = r.id))
  from public.config c limit 1;
$$;

-- Paso 1: qué reservas pisaría el bloqueo (no cambia nada)
create or replace function public.previsualizar_bloqueo(
  p_token uuid, p_canchas int[], p_fecha date, p_desde time, p_hasta time, p_semanal boolean
) returns json
language plpgsql stable security definer set search_path = public as $$
declare s public.socios := public._exigir_capitania(p_token);
begin
  return coalesce((
    select json_agg(public._reserva_json(r) order by r.inicio, r.cancha_id)
    from public._reservas_afectadas(p_canchas, p_fecha, p_desde, p_hasta, p_semanal) r
  ), '[]'::json);
end $$;

-- Paso 2: crear el bloqueo. Si pisa reservas, solo avanza con p_cancelar_reservas = true
drop function if exists public.crear_bloqueo(uuid, int[], date, time, time, text, boolean);

create or replace function public.crear_bloqueo(
  p_token uuid, p_canchas int[], p_fecha date, p_desde time, p_hasta time, p_motivo text,
  p_semanal boolean, p_cancelar_reservas boolean default false
) returns json
language plpgsql volatile security definer set search_path = public as $$
declare
  s public.socios := public._exigir_capitania(p_token);
  k int;
  afectadas uuid[];
  motivo text := trim(coalesce(p_motivo, ''));
begin
  if p_hasta <= p_desde then raise exception 'El horario "hasta" tiene que ser posterior a "desde".'; end if;
  if motivo = '' then raise exception 'Falta el motivo.'; end if;
  if coalesce(array_length(p_canchas, 1), 0) = 0 then raise exception 'Elegí al menos una cancha.'; end if;

  -- Trabamos las reservas afectadas para que nadie las cambie mientras tanto
  select array_agg(x.id) into afectadas from (
    select r.id from public.reservas r
    where r.id in (select id from public._reservas_afectadas(p_canchas, p_fecha, p_desde, p_hasta, p_semanal))
    for update
  ) x;

  if coalesce(array_length(afectadas, 1), 0) > 0 and not p_cancelar_reservas then
    raise exception 'Este bloqueo pisa % reserva(s) de socios. Revisalas y confirmá para cancelarlas.',
      array_length(afectadas, 1) using hint = 'CONFLICTO';
  end if;

  if coalesce(array_length(afectadas, 1), 0) > 0 then
    update public.reservas
       set estado = 'cancelada', cancelada = now(), cancelada_por = s.nro,
           motivo_cancelacion = motivo
     where id = any (afectadas);
  end if;

  foreach k in array p_canchas loop
    if p_semanal then
      insert into public.bloqueos (cancha_id, motivo, dia_semana, hora_desde, hora_hasta, creado_por)
      values (k, motivo, extract(dow from p_fecha)::int, p_desde, p_hasta, s.nro);
    else
      insert into public.bloqueos (cancha_id, motivo, inicio, fin, creado_por)
      values (k, motivo, public._instante(p_fecha, p_desde), public._instante(p_fecha, p_hasta), s.nro);
    end if;
  end loop;

  return json_build_object('ok', true, 'reservas_canceladas', coalesce(array_length(afectadas, 1), 0));
end $$;

-- Cancelación manual desde el panel: guardar quién y por qué
create or replace function public.cancelar_reserva(p_token uuid, p_id uuid) returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  s public.socios := public._socio_de_token(p_token);
  r public.reservas;
begin
  select * into r from public.reservas where id = p_id for update;
  if not found or r.estado <> 'activa' then
    raise exception 'La reserva no existe o ya estaba cancelada.';
  end if;
  if r.titular_nro <> s.nro and s.rol <> 'capitania' then
    raise exception 'Solo quien hizo la reserva puede cancelarla.';
  end if;
  update public.reservas
     set estado = 'cancelada', cancelada = now(), cancelada_por = s.nro,
         motivo_cancelacion = case when s.rol = 'capitania' and r.titular_nro <> s.nro
                                   then 'Cancelada por la Capitanía' end
   where id = p_id;
end $$;

-- Mis reservas: activas + las que me cancelaron otros (Capitanía o el titular)
-- y todavía no pasaron, para que me entere.
create or replace function public.mis_reservas(p_token uuid) returns json
language plpgsql stable security definer set search_path = public as $$
declare
  s public.socios := public._socio_de_token(p_token);
  z text := (select zona from public.config limit 1);
begin
  return coalesce((
    select json_agg(json_build_object(
      'id', r.id,
      'cancha', r.cancha_id,
      'tipo', r.tipo,
      'inicio', r.inicio,
      'fin', r.fin,
      'estado', r.estado,
      'cancelada_por_capitania', r.estado = 'cancelada' and cp.rol = 'capitania',
      'motivo_cancelacion', r.motivo_cancelacion,
      'fecha', (r.inicio at time zone z)::date,
      'hora_inicio', to_char(r.inicio at time zone z, 'HH24:MI'),
      'hora_fin', to_char(r.fin at time zone z, 'HH24:MI'),
      'soy_titular', r.titular_nro = s.nro,
      'jugadores', (
        select json_agg(json_build_object('nro', o.nro, 'nombre', public._nombre(o), 'titular', rj.es_titular)
                        order by rj.es_titular desc, o.apellido)
        from public.reserva_jugadores rj join public.socios o on o.nro = rj.socio_nro
        where rj.reserva_id = r.id
      )
    ) order by r.estado, r.inicio)
    from public.reservas r
    left join public.socios cp on cp.nro = r.cancelada_por
    where r.fin > now()
      and exists (select 1 from public.reserva_jugadores rj where rj.reserva_id = r.id and rj.socio_nro = s.nro)
      and (r.estado = 'activa'
           or (r.estado = 'cancelada' and r.cancelada_por <> s.nro and r.cancelada > now() - interval '7 days'))
  ), '[]'::json);
end $$;

revoke all on function public._reservas_afectadas(int[], date, time, time, boolean) from public, anon, authenticated;
revoke all on function public._reserva_json(public.reservas) from public, anon, authenticated;
revoke all on function public.previsualizar_bloqueo(uuid, int[], date, time, time, boolean) from public;
revoke all on function public.crear_bloqueo(uuid, int[], date, time, time, text, boolean, boolean) from public;
grant execute on function public.previsualizar_bloqueo(uuid, int[], date, time, time, boolean) to anon, authenticated;
grant execute on function public.crear_bloqueo(uuid, int[], date, time, time, text, boolean, boolean) to anon, authenticated;
grant execute on function public.cancelar_reserva(uuid, uuid) to anon, authenticated;
grant execute on function public.mis_reservas(uuid) to anon, authenticated;
