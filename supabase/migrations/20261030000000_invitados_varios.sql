-- =====================================================================
-- Invitados no socios: hasta completar el partido
--   * En dobles pueden ir hasta 3 invitados; en single, 1. Siempre tiene
--     que jugar al menos un socio con carnet (el que reserva).
--   * Cada invitado se cobra por separado: la Capitanía marca uno por uno.
-- Se corre en Supabase → SQL Editor, DESPUÉS de 20261029000000_invitados.sql.
-- =====================================================================

alter table public.reserva_invitados drop constraint if exists reserva_invitados_pkey;
alter table public.reserva_invitados add column if not exists id bigint generated always as identity;
alter table public.reserva_invitados add constraint reserva_invitados_pkey primary key (id);
create index if not exists reserva_invitados_reserva_idx on public.reserva_invitados (reserva_id);
create unique index if not exists reserva_invitados_reserva_dni_idx on public.reserva_invitados (reserva_id, dni);

-- Marcar que pagó: ahora por invitado
drop function if exists public.capitania_invitado_pago(uuid, uuid, boolean);
create or replace function public.capitania_invitado_pago(p_token uuid, p_invitado bigint, p_pagado boolean) returns json
language plpgsql volatile security definer set search_path = public as $$
declare s public.socios := public._exigir_capitania(p_token);
begin
  update public.reserva_invitados
     set pagado = p_pagado, pagado_en = case when p_pagado then now() end, pagado_por = case when p_pagado then s.nro end
   where id = p_invitado;
  if not found then raise exception 'No encontramos a ese invitado.'; end if;
  return json_build_object('pagado', p_pagado);
end $$;

create or replace function public.reservar(
  p_token uuid, p_cancha int, p_inicio timestamptz, p_tipo text, p_jugadores text[], p_invitado jsonb default null
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
  -- p_invitado: un objeto {nombre, apellido, dni} o una lista de ellos
  invs jsonb := case when p_invitado is null then '[]'::jsonb
                     when jsonb_typeof(p_invitado) = 'array' then p_invitado
                     else jsonb_build_array(p_invitado) end;
  n_inv int := jsonb_array_length(case when p_invitado is null then '[]'::jsonb
                     when jsonb_typeof(p_invitado) = 'array' then p_invitado
                     else jsonb_build_array(p_invitado) end);
  con_invitado boolean := n_inv > 0;
  inv jsonb;
  inv_dni text;
begin
  if dur is null then raise exception 'Tipo de partido inválido.'; end if;
  need := case p_tipo when 'single' then 1 else 3 end;

  if not public._carnet_ok(s) then
    raise exception 'Tu carnet de tenis no figura vigente.';
  end if;

  select array_agg(distinct x) into todos from unnest(coalesce(p_jugadores, '{}')) x where x <> s.nro;
  todos := coalesce(todos, '{}');
  if n_inv > need then raise exception 'Tiene que jugar al menos un socio con carnet: vos.'; end if;
  for inv in select * from jsonb_array_elements(invs) loop
    if trim(coalesce(inv->>'nombre', '')) = '' or trim(coalesce(inv->>'apellido', '')) = '' then
      raise exception 'Completá nombre y apellido de cada invitado.';
    end if;
    inv_dni := regexp_replace(coalesce(inv->>'dni', ''), '\D', '', 'g');
    if length(inv_dni) < 6 then raise exception 'El DNI de % no es válido.', trim(inv->>'nombre'); end if;
    if exists (select 1 from public.socios x where x.rol = 'socio' and regexp_replace(x.dni, '\D', '', 'g') = inv_dni and public._carnet_ok(x)) then
      raise exception 'El DNI % es de un socio con carnet: sumalo como socio, no como invitado.', inv_dni;
    end if;
  end loop;
  if (select count(distinct regexp_replace(coalesce(x->>'dni', ''), '\D', '', 'g')) from jsonb_array_elements(invs) x) <> n_inv then
    raise exception 'Hay dos invitados con el mismo DNI.';
  end if;
  if cardinality(todos) + n_inv <> need then
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

  if con_invitado and not public._invitado_permitido(p_inicio, fin) then
    raise exception 'Los invitados no socios solo pueden jugar %.', public._texto_franjas_invitados();
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

  insert into public.reserva_invitados (reserva_id, nombre, apellido, dni, cargado_por)
  select rid, initcap(trim(x->>'nombre')), initcap(trim(x->>'apellido')),
         regexp_replace(coalesce(x->>'dni', ''), '\D', '', 'g'), s.nro
  from jsonb_array_elements(invs) x;

  return json_build_object('id', rid);
end $$;

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
      ),
      'invitados', (select json_agg(json_build_object('nombre', i.nombre || ' ' || i.apellido, 'pagado', i.pagado) order by i.id)
                      from public.reserva_invitados i where i.reserva_id = r.id)
    ) order by r.estado, r.inicio)
    from public.reservas r
    left join public.socios cp on cp.nro = r.cancelada_por
    where r.fin > now()
      and exists (select 1 from public.reserva_jugadores rj where rj.reserva_id = r.id and rj.socio_nro = s.nro)
      and (r.estado = 'activa'
           or (r.estado = 'cancelada' and r.cancelada_por <> s.nro and r.cancelada > now() - interval '7 days'))
  ), '[]'::json);
end $$;

create or replace function public.panel_dia(p_token uuid, p_fecha date) returns json
language plpgsql stable security definer set search_path = public as $$
declare
  s public.socios := public._exigir_capitania(p_token);
  c public.config := public._cfg();
  horas json;
  filas json;
  bloq json;
begin
  select json_agg(to_char(h, 'HH24:MI') order by h) into horas
  from generate_series(p_fecha + c.hora_apertura, p_fecha + c.hora_cierre - interval '30 minutes', interval '30 minutes') h;

  select json_agg(json_build_object('cancha', k.id, 'celdas', (
    select json_agg(
      case
        when public._bloqueo(k.id, public._instante(p_fecha, h::time), public._instante(p_fecha, h::time) + interval '30 minutes') is not null
          then json_build_object('estado', 'bloqueada', 'detalle',
            public._bloqueo(k.id, public._instante(p_fecha, h::time), public._instante(p_fecha, h::time) + interval '30 minutes'))
        else coalesce((
          select json_build_object('estado', 'reservada', 'reserva_id', r.id,
                   'invitado', (select case when count(*) = 0 then null when bool_and(i.pagado) then 'pagado' else 'a_cobrar' end
                                  from public.reserva_invitados i where i.reserva_id = r.id),
                   'detalle',
                   (select string_agg(public._nombre(o), ', ' order by rj.es_titular desc)
                      from public.reserva_jugadores rj join public.socios o on o.nro = rj.socio_nro
                     where rj.reserva_id = r.id)
                   || coalesce((select string_agg(', ' || i.nombre || ' ' || i.apellido || ' (invitado'
                                                  || case when i.pagado then ', pagó)' else ', a cobrar)' end, '' order by i.id)
                                  from public.reserva_invitados i where i.reserva_id = r.id), ''))
          from public.reservas r
          where r.cancha_id = k.id and r.estado = 'activa'
            and tstzrange(r.inicio, r.fin) && tstzrange(public._instante(p_fecha, h::time), public._instante(p_fecha, h::time) + interval '30 minutes')
          limit 1
        ), json_build_object('estado', 'libre'))
      end order by h)
    from generate_series(p_fecha + c.hora_apertura, p_fecha + c.hora_cierre - interval '30 minutes', interval '30 minutes') h
  )) order by k.id) into filas
  from public.canchas k;

  select json_agg(json_build_object(
           'id', b.id, 'cancha', b.cancha_id, 'motivo', b.motivo,
           'semanal', b.dia_semana is not null,
           'desde', to_char(coalesce(b.hora_desde, (b.inicio at time zone c.zona)::time), 'HH24:MI'),
           'hasta', to_char(coalesce(b.hora_hasta, (b.fin at time zone c.zona)::time), 'HH24:MI'))
         order by b.motivo, b.cancha_id) into bloq
  from public.bloqueos b
  where (b.dia_semana is not null and b.dia_semana = extract(dow from p_fecha)::int)
     or (b.inicio is not null and tstzrange(b.inicio, b.fin) && tstzrange(public._instante(p_fecha, '00:00'), public._instante(p_fecha + 1, '00:00')));

  return json_build_object('fecha', p_fecha, 'horas', horas,
                           'filas', coalesce(filas, '[]'::json), 'bloqueos', coalesce(bloq, '[]'::json));
end $$;

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
    'invitados', (select json_agg(json_build_object('id', i.id, 'nombre', i.nombre || ' ' || i.apellido, 'dni', i.dni, 'pagado', i.pagado,
                                          'pagado_en', i.pagado_en,
                                          'veces_mes', (select count(*) from public.reserva_invitados i2 join public.reservas r2 on r2.id = i2.reserva_id
                                                         where i2.dni = i.dni and r2.estado = 'activa'
                                                           and date_trunc('month', r2.inicio at time zone z) = date_trunc('month', r.inicio at time zone z)))
                                  order by i.id)
                   from public.reserva_invitados i where i.reserva_id = r.id),
    'canchas_libres', coalesce((select json_agg(c.id order by c.id) from public.canchas c
                                 where c.id <> r.cancha_id and public._ocupada(c.id, r.inicio, r.fin) is null), '[]'::json)
  );
end $$;

revoke all on function public.capitania_invitado_pago(uuid, bigint, boolean) from public;
grant execute on function public.capitania_invitado_pago(uuid, bigint, boolean) to anon, authenticated;
grant execute on function public.reservar(uuid, int, timestamptz, text, text[], jsonb) to anon, authenticated;
grant execute on function public.mis_reservas(uuid) to anon, authenticated;
grant execute on function public.panel_dia(uuid, date) to anon, authenticated;
grant execute on function public.capitania_reserva(uuid, uuid) to anon, authenticated;

notify pgrst, 'reload schema';
