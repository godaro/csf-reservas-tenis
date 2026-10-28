-- =====================================================================
-- Hasta 2 reservas activas por socio (titular o invitado), con al menos
-- 1 hora libre entre una y otra. Los dos valores se cambian en la tabla
-- config: max_reservas y separacion_min.
-- Se corre en Supabase → SQL Editor.
-- =====================================================================

alter table public.config add column if not exists max_reservas int not null default 2;
alter table public.config add column if not exists separacion_min int not null default 60;

-- Reservas activas por jugar del socio
create or replace function public._reservas_activas(p_nro text) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from public.reserva_jugadores j
  join public.reservas r on r.id = j.reserva_id
  where j.socio_nro = p_nro and r.estado = 'activa' and r.fin > now();
$$;

-- ¿Puede el socio sumar una reserva en [p_inicio, p_fin)?
--   null = sí · 'limite' = ya tiene el máximo · 'cerca' = le queda pegada a otra suya
-- Sin horario (p_inicio null) solo mira el límite.
create or replace function public._impide_reservar(p_nro text, p_inicio timestamptz, p_fin timestamptz) returns text
language plpgsql stable security definer set search_path = public as $$
declare c public.config := public._cfg();
begin
  if public._reservas_activas(p_nro) >= c.max_reservas then return 'limite'; end if;
  if p_inicio is not null and exists (
    select 1 from public.reserva_jugadores j
    join public.reservas r on r.id = j.reserva_id
    where j.socio_nro = p_nro and r.estado = 'activa' and r.fin > now()
      and tstzrange(r.inicio - make_interval(mins => c.separacion_min), r.fin + make_interval(mins => c.separacion_min))
          && tstzrange(p_inicio, coalesce(p_fin, p_inicio + interval '1 minute'))
  ) then return 'cerca'; end if;
  return null;
end $$;

create or replace function public._texto_minutos(m int) returns text
language sql immutable as $$
  select case when m % 60 = 0 then (m / 60) || case when m = 60 then ' hora' else ' horas' end
              else m || ' minutos' end;
$$;

create or replace function public.reservar(
  p_token uuid, p_cancha int, p_inicio timestamptz, p_tipo text, p_jugadores text[]
) returns json
language plpgsql volatile security definer set search_path = public as $$
declare
  s public.socios := public._socio_de_token(p_token);
  c public.config := public._cfg();
  dur int := public._minutos(p_tipo);
  need int;
  fin timestamptz;
  li timestamp;
  todos text[];
  n text;
  j public.socios;
  motivo text;
  rid uuid;
begin
  if dur is null then raise exception 'Tipo de partido inválido.'; end if;
  need := case p_tipo when 'single' then 1 else 3 end;

  if not public._carnet_ok(s) then
    raise exception 'Tu carnet de tenis no figura vigente.';
  end if;

  select array_agg(distinct x) into todos from unnest(coalesce(p_jugadores, '{}')) x where x <> s.nro;
  if coalesce(array_length(todos, 1), 0) <> need then
    raise exception 'Para un partido de % hay que sumar % jugador%.',
      p_tipo, need, case when need = 1 then '' else 'es' end;
  end if;

  foreach n in array todos loop
    select * into j from public.socios where nro = n;
    if not found then raise exception 'No encontramos al socio %.', n; end if;
    if not public._carnet_ok(j) then
      raise exception '% no tiene carnet de tenis vigente.', public._nombre(j);
    end if;
  end loop;

  -- Horario válido
  fin := p_inicio + make_interval(mins => dur);
  li := p_inicio at time zone c.zona;
  if extract(second from li) <> 0 or extract(minute from li)::int not in (0, 30) then
    raise exception 'Horario inválido.';
  end if;
  if li::time < c.hora_apertura or (fin at time zone c.zona)::time > c.hora_cierre
     or (fin at time zone c.zona)::date <> li::date then
    raise exception 'Ese horario está fuera del horario de las canchas.';
  end if;
  if p_inicio <= now() then
    raise exception 'Ese horario ya pasó.';
  end if;
  if now() < public._habilita_en(li::date) then
    raise exception 'Los turnos de ese día todavía no están habilitados.';
  end if;

  -- Bloqueos de Capitanía / cancha fuera de servicio
  motivo := public._bloqueo(p_cancha, p_inicio, fin);
  if motivo is not null then
    raise exception 'La cancha % no está disponible en ese horario (%).', p_cancha, motivo;
  end if;
  if not coalesce((select activa from public.canchas where id = p_cancha), false) then
    raise exception 'Esa cancha no está disponible.';
  end if;

  -- Límite de reservas y separación mínima entre reservas, por socio.
  -- Bloqueo por socio (en orden, sin deadlocks) para que dos reservas simultáneas no se salteen la regla.
  todos := array(select x from unnest(todos || s.nro) x order by x);
  foreach n in array todos loop
    perform pg_advisory_xact_lock(hashtext('socio:' || n));
  end loop;
  foreach n in array todos loop
    motivo := public._impide_reservar(n, p_inicio, fin);
    if motivo is not null then
      select * into j from public.socios where nro = n;
      if n = s.nro then
        raise exception '%', case motivo
          when 'limite' then format('Ya tenés %s reservas activas, el máximo. Cancelá una para reservar otra.', c.max_reservas)
          else format('Ya tenés otra reserva muy cerca de ese horario: tiene que haber al menos %s entre una y otra.', public._texto_minutos(c.separacion_min))
        end;
      else
        raise exception '%', case motivo
          when 'limite' then format('%s ya tiene %s reservas activas, el máximo.', public._nombre(j), c.max_reservas)
          else format('%s tiene otra reserva muy cerca de ese horario (a menos de %s).', public._nombre(j), public._texto_minutos(c.separacion_min))
        end;
      end if;
    end if;
  end loop;

  begin
    insert into public.reservas (cancha_id, inicio, fin, tipo, titular_nro)
    values (p_cancha, p_inicio, fin, p_tipo, s.nro)
    returning id into rid;
  exception when exclusion_violation then
    raise exception 'Uy, alguien reservó la cancha % recién. Elegí otra.', p_cancha
      using hint = 'OCUPADA';
  end;

  insert into public.reserva_jugadores (reserva_id, socio_nro, es_titular)
  select rid, x, x = s.nro from unnest(todos) x;

  return json_build_object('id', rid);
end $$;

create or replace function public.disponibilidad(p_token uuid, p_fecha date, p_tipo text) returns json
language plpgsql stable security definer set search_path = public as $$
declare
  s public.socios := public._socio_de_token(p_token);
  c public.config := public._cfg();
  dur int := public._minutos(p_tipo);
  hab timestamptz := public._habilita_en(p_fecha);
  t time;
  ini timestamptz;
  fin timestamptz;
  libres int[];
  ocupadas json[];
  motivo text;
  slots json[] := '{}';
  k record;
begin
  if dur is null then raise exception 'Tipo de partido inválido.'; end if;

  if now() >= hab then
    t := c.hora_apertura;
    while t + make_interval(mins => dur) <= c.hora_cierre
          and t + make_interval(mins => dur) > t loop
      ini := public._instante(p_fecha, t);
      fin := ini + make_interval(mins => dur);
      if ini > now() then
        libres := '{}'; ocupadas := '{}';
        for k in select id from public.canchas order by id loop
          motivo := public._ocupada(k.id, ini, fin);
          if motivo is null then
            libres := libres || k.id;
          else
            ocupadas := ocupadas || json_build_object('cancha', k.id, 'motivo', motivo);
          end if;
        end loop;
        slots := slots || json_build_object('hora', to_char(t, 'HH24:MI'), 'inicio', ini,
                                            'libres', libres, 'ocupadas', ocupadas,
                                            -- este horario me queda pegado a otra reserva mía
                                            'cerca_de_otra', public._impide_reservar(s.nro, ini, fin) = 'cerca');
      end if;
      t := t + interval '30 minutes';
    end loop;
  end if;

  return json_build_object(
    'fecha', p_fecha,
    'tipo', p_tipo,
    'habilitado', now() >= hab,
    'habilita_en', hab,
    'mi_reserva_activa', public._reservas_activas(s.nro) >= c.max_reservas,  -- llegó al máximo
    'mis_reservas_activas', public._reservas_activas(s.nro),
    'max_reservas', c.max_reservas,
    'separacion_min', c.separacion_min,
    'slots', array_to_json(slots)
  );
end $$;

drop function if exists public.buscar_socios(uuid, text);
create or replace function public.buscar_socios(p_token uuid, p_q text, p_inicio timestamptz default null, p_fin timestamptz default null) returns json
language plpgsql stable security definer set search_path = public as $$
declare
  s public.socios := public._socio_de_token(p_token);
  q text := trim(coalesce(p_q, ''));
begin
  if length(q) < 2 then return '[]'::json; end if;
  return coalesce((
    select json_agg(x order by x.nombre) from (
      select o.nro,
             public._nombre(o) as nombre,
             case
               when not public._carnet_ok(o) then 'sin_carnet'
               when public._impide_reservar(o.nro, p_inicio, p_fin) = 'limite' then 'con_reserva'
               when public._impide_reservar(o.nro, p_inicio, p_fin) = 'cerca' then 'muy_cerca'
               else 'ok'
             end as estado
      from public.socios o
      where o.nro <> s.nro
        and o.activo
        and o.rol = 'socio'
        and (o.nro like (q || '%')
             or public._norm(o.nombre || ' ' || o.apellido) like ('%' || public._norm(q) || '%')
             or public._norm(o.apellido || ' ' || o.nombre) like ('%' || public._norm(q) || '%'))
      order by o.apellido, o.nombre
      limit 10
    ) x
  ), '[]'::json);
end $$;

drop function if exists public.companeros_frecuentes(uuid);
create or replace function public.companeros_frecuentes(p_token uuid, p_inicio timestamptz default null, p_fin timestamptz default null) returns json
language plpgsql stable security definer set search_path = public as $$
declare
  s public.socios := public._socio_de_token(p_token);
begin
  return coalesce((
    select json_agg(x order by x.partidos desc, x.ultimo desc) from (
      select o.nro,
             public._nombre(o) as nombre,
             count(*) as partidos,
             max(r.inicio) as ultimo,
             case
               when not public._carnet_ok(o) then 'sin_carnet'
               when public._impide_reservar(o.nro, p_inicio, p_fin) = 'limite' then 'con_reserva'
               when public._impide_reservar(o.nro, p_inicio, p_fin) = 'cerca' then 'muy_cerca'
               else 'ok'
             end as estado
      from public.reserva_jugadores yo
      join public.reservas r             on r.id = yo.reserva_id and r.estado = 'activa'
      join public.reserva_jugadores otro on otro.reserva_id = yo.reserva_id and otro.socio_nro <> yo.socio_nro
      join public.socios o               on o.nro = otro.socio_nro and o.activo and o.rol = 'socio'
      where yo.socio_nro = s.nro
        and r.inicio > now() - interval '180 days'
      group by o.nro
      order by count(*) desc, max(r.inicio) desc
      limit 6
    ) x
  ), '[]'::json);
end $$;

revoke all on function public._reservas_activas(text) from public, anon, authenticated;
revoke all on function public._impide_reservar(text, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.buscar_socios(uuid, text, timestamptz, timestamptz) from public;
revoke all on function public.companeros_frecuentes(uuid, timestamptz, timestamptz) from public;
grant execute on function public.buscar_socios(uuid, text, timestamptz, timestamptz) to anon, authenticated;
grant execute on function public.companeros_frecuentes(uuid, timestamptz, timestamptz) to anon, authenticated;
grant execute on function public.reservar(uuid, int, timestamptz, text, text[]) to anon, authenticated;
grant execute on function public.disponibilidad(uuid, date, text) to anon, authenticated;

notify pgrst, 'reload schema';
