-- =====================================================================
-- Invitados no socios
--   * Al reservar, el socio puede sumar UN invitado no socio por partido
--     (nombre, apellido y DNI). El invitado paga el día en la Capitanía.
--   * Solo en las franjas habilitadas (config.invitados_franjas):
--     miércoles y viernes de 8 a 22, domingos desde las 12.
--   * En el panel la reserva figura "a cobrar" hasta que la Capitanía
--     marca que pagó.
-- Se corre en Supabase → SQL Editor, DESPUÉS de
-- 20261028030000_capitania_editar_reserva.sql.
-- =====================================================================

create table if not exists public.reserva_invitados (
  reserva_id  uuid primary key references public.reservas (id) on delete cascade,  -- uno por partido
  nombre      text not null,
  apellido    text not null,
  dni         text not null,
  cargado_por text references public.socios (nro),
  creado      timestamptz not null default now(),
  pagado      boolean not null default false,
  pagado_en   timestamptz,
  pagado_por  text references public.socios (nro)
);
create index if not exists reserva_invitados_dni_idx on public.reserva_invitados (dni);
alter table public.reserva_invitados enable row level security;
revoke all on public.reserva_invitados from anon, authenticated;

-- Franjas en que se admiten invitados (dia: 0 = domingo … 6 = sábado)
alter table public.config add column if not exists invitados_franjas jsonb not null default
  '[{"dia":3,"desde":"08:00","hasta":"22:00"},{"dia":5,"desde":"08:00","hasta":"22:00"},{"dia":0,"desde":"12:00","hasta":"22:00"}]';

create or replace function public._invitado_permitido(p_inicio timestamptz, p_fin timestamptz) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.config c, jsonb_array_elements(c.invitados_franjas) f
    where (f->>'dia')::int = extract(dow from p_inicio at time zone c.zona)::int
      and (p_inicio at time zone c.zona)::time >= (f->>'desde')::time
      and (p_fin at time zone c.zona)::time <= (f->>'hasta')::time
  );
$$;

-- "los miércoles y viernes de 8 a 22 h y los domingos desde las 12 h"
create or replace function public._texto_franjas_invitados() returns text
language sql stable security definer set search_path = public as $$
  with f as (
    select (x->>'dia')::int as dia, (x->>'desde')::time as desde, (x->>'hasta')::time as hasta,
           (array['domingos','lunes','martes','miércoles','jueves','viernes','sábados'])[(x->>'dia')::int + 1] as nombre
    from public.config c, jsonb_array_elements(c.invitados_franjas) x
  ), g as (
    select desde, hasta, array_agg(nombre order by case when dia = 0 then 7 else dia end) as dias,
           min(case when dia = 0 then 7 else dia end) as orden
    from f group by desde, hasta
  )
  select string_agg(
    'los ' || case when cardinality(dias) = 1 then dias[1]
                   else array_to_string(dias[1:cardinality(dias) - 1], ', ') || ' y ' || dias[cardinality(dias)] end
    || case when hasta >= '22:00' and desde > (select hora_apertura from public.config limit 1)
            then ' desde las ' || to_char(desde, 'FMHH24') || ' h'
            else ' de ' || to_char(desde, 'FMHH24') || ' a ' || to_char(hasta, 'FMHH24') || ' h' end,
    ' y ' order by orden)
  from g;
$$;

-- Para la pantalla de compañeros: si en ese horario se puede sumar un invitado
create or replace function public.invitados_reglas(p_token uuid, p_inicio timestamptz default null, p_fin timestamptz default null)
returns json
language plpgsql stable security definer set search_path = public as $$
declare s public.socios := public._socio_de_token(p_token);
begin
  return json_build_object(
    'permitido', case when p_inicio is null then null else public._invitado_permitido(p_inicio, p_fin) end,
    'texto', public._texto_franjas_invitados());
end $$;

-- Capitanía: marcar que el invitado pagó (o deshacerlo)
create or replace function public.capitania_invitado_pago(p_token uuid, p_id uuid, p_pagado boolean) returns json
language plpgsql volatile security definer set search_path = public as $$
declare s public.socios := public._exigir_capitania(p_token);
begin
  update public.reserva_invitados
     set pagado = p_pagado, pagado_en = case when p_pagado then now() end, pagado_por = case when p_pagado then s.nro end
   where reserva_id = p_id;
  if not found then raise exception 'Esa reserva no tiene invitado.'; end if;
  return json_build_object('pagado', p_pagado);
end $$;

drop function if exists public.reservar(uuid, int, timestamptz, text, text[]);

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
  inv_nombre text := initcap(trim(coalesce(p_invitado->>'nombre', '')));
  inv_apellido text := initcap(trim(coalesce(p_invitado->>'apellido', '')));
  inv_dni text := regexp_replace(coalesce(p_invitado->>'dni', ''), '\D', '', 'g');
  con_invitado boolean := p_invitado is not null;
begin
  if dur is null then raise exception 'Tipo de partido inválido.'; end if;
  need := case p_tipo when 'single' then 1 else 3 end;

  if not public._carnet_ok(s) then
    raise exception 'Tu carnet de tenis no figura vigente.';
  end if;

  select array_agg(distinct x) into todos from unnest(coalesce(p_jugadores, '{}')) x where x <> s.nro;
  todos := coalesce(todos, '{}');
  if con_invitado then
    if inv_nombre = '' or inv_apellido = '' then raise exception 'Completá nombre y apellido del invitado.'; end if;
    if length(inv_dni) < 6 then raise exception 'El DNI del invitado no es válido.'; end if;
    if exists (select 1 from public.socios x where x.rol = 'socio' and regexp_replace(x.dni, '\D', '', 'g') = inv_dni and public._carnet_ok(x)) then
      raise exception 'Ese DNI es de un socio con carnet: sumalo como socio, no como invitado.';
    end if;
  end if;
  if cardinality(todos) + (case when con_invitado then 1 else 0 end) <> need then
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

  if con_invitado then
    insert into public.reserva_invitados (reserva_id, nombre, apellido, dni, cargado_por)
    values (rid, inv_nombre, inv_apellido, inv_dni, s.nro);
  end if;

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
      'invitado', (select json_build_object('nombre', i.nombre || ' ' || i.apellido, 'pagado', i.pagado)
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
                   'invitado', case when i.reserva_id is null then null when i.pagado then 'pagado' else 'a_cobrar' end,
                   'detalle',
                   (select string_agg(public._nombre(o), ', ' order by rj.es_titular desc)
                      from public.reserva_jugadores rj join public.socios o on o.nro = rj.socio_nro
                     where rj.reserva_id = r.id)
                   || coalesce(', ' || i.nombre || ' ' || i.apellido || ' (invitado' || case when i.pagado then ', pagó)' else ', a cobrar)' end, ''))
          from public.reservas r
          left join public.reserva_invitados i on i.reserva_id = r.id
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

-- Detalle para la Capitanía: suma el invitado
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
    'invitado', (select json_build_object('nombre', i.nombre || ' ' || i.apellido, 'dni', i.dni, 'pagado', i.pagado,
                                          'pagado_en', i.pagado_en,
                                          'veces_mes', (select count(*) from public.reserva_invitados i2 join public.reservas r2 on r2.id = i2.reserva_id
                                                         where i2.dni = i.dni and r2.estado = 'activa'
                                                           and date_trunc('month', r2.inicio at time zone z) = date_trunc('month', r.inicio at time zone z)))
                   from public.reserva_invitados i where i.reserva_id = r.id),
    'canchas_libres', coalesce((select json_agg(c.id order by c.id) from public.canchas c
                                 where c.id <> r.cancha_id and public._ocupada(c.id, r.inicio, r.fin) is null), '[]'::json)
  );
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
    'otros', (select json_agg(x.n order by x.o) from (
                select public._nombre(o) as n, (case when rj.es_titular then 0 else 1 end)::text || o.apellido as o
                  from public.reserva_jugadores rj join public.socios o on o.nro = rj.socio_nro
                 where rj.reserva_id = r.id and rj.socio_nro <> t.socio_nro
                union all
                select i.nombre || ' ' || i.apellido || ' (invitado)', '9' from public.reserva_invitados i where i.reserva_id = r.id
              ) x),
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

revoke all on function public._invitado_permitido(timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public._texto_franjas_invitados() from public, anon, authenticated;
revoke all on function public.reservar(uuid, int, timestamptz, text, text[], jsonb) from public;
revoke all on function public.invitados_reglas(uuid, timestamptz, timestamptz) from public;
revoke all on function public.capitania_invitado_pago(uuid, uuid, boolean) from public;
revoke all on function public.avisos_tomar(int) from public, anon, authenticated;
grant execute on function public.avisos_tomar(int) to service_role;
grant execute on function public.reservar(uuid, int, timestamptz, text, text[], jsonb) to anon, authenticated;
grant execute on function public.invitados_reglas(uuid, timestamptz, timestamptz) to anon, authenticated;
grant execute on function public.capitania_invitado_pago(uuid, uuid, boolean) to anon, authenticated;
grant execute on function public.mis_reservas(uuid) to anon, authenticated;
grant execute on function public.panel_dia(uuid, date) to anon, authenticated;
grant execute on function public.capitania_reserva(uuid, uuid) to anon, authenticated;

notify pgrst, 'reload schema';
