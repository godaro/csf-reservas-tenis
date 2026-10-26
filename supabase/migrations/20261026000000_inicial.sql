-- =====================================================================
-- Reservas de Tenis · Club San Fernando
-- Esquema inicial. Se corre UNA vez en Supabase → SQL Editor.
--
-- Diseño:
--   * Las tablas NO se leen ni escriben directo desde la web (RLS activado
--     sin políticas). Todo pasa por funciones (RPC) que validan las reglas.
--   * Login con número de socio + DNI → token de sesión propio.
--   * Reglas blindadas en la base:
--       - nunca dos reservas superpuestas en la misma cancha (EXCLUDE);
--       - un socio solo puede tener UNA reserva activa (titular o jugador);
--       - todos los jugadores deben tener carnet de tenis vigente;
--       - ventana de reserva (ej: el domingo se habilita el viernes 22:00).
-- =====================================================================

create extension if not exists btree_gist with schema extensions;
create extension if not exists pgcrypto with schema extensions;

set search_path = public, extensions;

-- ---------------------------------------------------------------------
-- Configuración general (una sola fila)
-- ---------------------------------------------------------------------
create table public.config (
  id                 boolean primary key default true check (id),
  hora_apertura      time    not null default '08:00',
  hora_cierre        time    not null default '22:00',
  dias_anticipacion  int     not null default 2,      -- el día D se habilita D-2 ...
  hora_habilitacion  time    not null default '22:00',-- ... a las 22:00
  zona               text    not null default 'America/Argentina/Buenos_Aires'
);
insert into public.config default values;

-- ---------------------------------------------------------------------
-- Socios (se cargan desde el Excel / AF Sistemas)
-- ---------------------------------------------------------------------
create table public.socios (
  nro                    text primary key,
  dni                    text not null,
  nombre                 text not null,
  apellido               text not null default '',
  activo                 boolean not null default true,
  carnet_tenis           boolean not null default false,
  carnet_vence           date,
  celular                text,
  email                  text,
  rol                    text not null default 'socio' check (rol in ('socio', 'capitania')),
  login_fallas           int  not null default 0,
  login_bloqueado_hasta  timestamptz,
  actualizado            timestamptz not null default now()
);

create table public.canchas (
  id      int  primary key,
  nombre  text not null,
  activa  boolean not null default true
);
insert into public.canchas (id, nombre)
select n, 'Cancha ' || n from generate_series(1, 15) as n;

create table public.sesiones (
  token      uuid primary key default gen_random_uuid(),
  socio_nro  text not null references public.socios (nro) on delete cascade,
  creada     timestamptz not null default now(),
  vence      timestamptz not null default now() + interval '30 days'
);
create index sesiones_socio_idx on public.sesiones (socio_nro);

-- ---------------------------------------------------------------------
-- Reservas
-- ---------------------------------------------------------------------
create table public.reservas (
  id             uuid primary key default gen_random_uuid(),
  cancha_id      int  not null references public.canchas (id),
  inicio         timestamptz not null,
  fin            timestamptz not null,
  tipo           text not null check (tipo in ('single', 'dobles')),
  titular_nro    text not null references public.socios (nro),
  estado         text not null default 'activa' check (estado in ('activa', 'cancelada')),
  creada         timestamptz not null default now(),
  cancelada      timestamptz,
  cancelada_por  text references public.socios (nro),
  check (fin > inicio),
  -- Garantía dura: dos reservas activas nunca se pisan en la misma cancha.
  constraint reservas_sin_superposicion
    exclude using gist (cancha_id with =, tstzrange(inicio, fin) with &&)
    where (estado = 'activa')
);
create index reservas_inicio_idx on public.reservas (inicio);

create table public.reserva_jugadores (
  reserva_id  uuid not null references public.reservas (id) on delete cascade,
  socio_nro   text not null references public.socios (nro),
  es_titular  boolean not null default false,
  primary key (reserva_id, socio_nro)
);
create index reserva_jugadores_socio_idx on public.reserva_jugadores (socio_nro);

-- ---------------------------------------------------------------------
-- Bloqueos de Capitanía: puntuales (fecha y hora) o semanales (día + horario)
-- ---------------------------------------------------------------------
create table public.bloqueos (
  id          uuid primary key default gen_random_uuid(),
  cancha_id   int  not null references public.canchas (id),
  motivo      text not null,
  inicio      timestamptz,             -- puntual
  fin         timestamptz,
  dia_semana  int check (dia_semana between 0 and 6),  -- semanal (0 = domingo)
  hora_desde  time,
  hora_hasta  time,
  creado_por  text references public.socios (nro),
  creado      timestamptz not null default now(),
  check (
    (inicio is not null and fin is not null and fin > inicio and dia_semana is null)
    or
    (inicio is null and dia_semana is not null and hora_desde is not null and hora_hasta > hora_desde)
  )
);

-- Nadie lee ni escribe las tablas directo: solo vía las funciones de abajo.
alter table public.config            enable row level security;
alter table public.socios            enable row level security;
alter table public.canchas           enable row level security;
alter table public.sesiones          enable row level security;
alter table public.reservas          enable row level security;
alter table public.reserva_jugadores enable row level security;
alter table public.bloqueos          enable row level security;

-- =====================================================================
-- Funciones internas (no expuestas a la web)
-- =====================================================================

create or replace function public._cfg() returns public.config
language sql stable security definer set search_path = public as $$
  select * from public.config limit 1;
$$;

-- Hora local "de pared" del Club (timestamp sin zona)
create or replace function public._ahora_local() returns timestamp
language sql stable security definer set search_path = public as $$
  select now() at time zone (select zona from public.config limit 1);
$$;

-- Fecha + hora local → instante (timestamptz)
create or replace function public._instante(p_fecha date, p_hora time) returns timestamptz
language sql stable security definer set search_path = public as $$
  select (p_fecha + p_hora) at time zone (select zona from public.config limit 1);
$$;

create or replace function public._socio_de_token(p_token uuid) returns public.socios
language plpgsql stable security definer set search_path = public as $$
declare v public.socios;
begin
  select s.* into v
  from public.sesiones x join public.socios s on s.nro = x.socio_nro
  where x.token = p_token and x.vence > now();
  if not found then
    raise exception 'Tu sesión venció. Volvé a ingresar.' using errcode = 'P0001', hint = 'SESION';
  end if;
  return v;
end $$;

create or replace function public._carnet_ok(s public.socios) returns boolean
language sql stable security definer set search_path = public as $$
  select s.activo and s.carnet_tenis
     and (s.carnet_vence is null or s.carnet_vence >= public._ahora_local()::date);
$$;

create or replace function public._nombre(s public.socios) returns text
language sql immutable as $$
  select trim(s.nombre || ' ' || s.apellido);
$$;

-- Texto sin acentos y en minúscula, para búsquedas ("rios" encuentra "Ríos")
create or replace function public._norm(t text) returns text
language sql immutable as $$
  select lower(translate(coalesce(t, ''), 'áéíóúàèìòùäëïöüâêîôûñÁÉÍÓÚÀÈÌÒÙÄËÏÖÜÂÊÎÔÛÑ',
                                          'aeiouaeiouaeiouaeiounAEIOUAEIOUAEIOUAEIOUN'));
$$;

-- ¿El socio ya tiene una reserva activa por jugar (titular o jugador)?
create or replace function public._tiene_reserva_activa(p_nro text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.reserva_jugadores j
    join public.reservas r on r.id = j.reserva_id
    where j.socio_nro = p_nro and r.estado = 'activa' and r.fin > now()
  );
$$;

-- Motivo del bloqueo que pisa el rango, o null
create or replace function public._bloqueo(p_cancha int, p_inicio timestamptz, p_fin timestamptz)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  z text := (select zona from public.config limit 1);
  li timestamp := p_inicio at time zone z;
  lf timestamp := p_fin at time zone z;
  m text;
begin
  select b.motivo into m from public.bloqueos b
  where b.cancha_id = p_cancha
    and (
      (b.inicio is not null and tstzrange(b.inicio, b.fin) && tstzrange(p_inicio, p_fin))
      or
      (b.dia_semana is not null
        and b.dia_semana = extract(dow from li)::int
        and b.hora_desde < lf::time and b.hora_hasta > li::time)
    )
  limit 1;
  return m;
end $$;

-- Motivo por el que la cancha no está libre en el rango, o null si está libre
create or replace function public._ocupada(p_cancha int, p_inicio timestamptz, p_fin timestamptz)
returns text language plpgsql stable security definer set search_path = public as $$
declare m text;
begin
  if not (select activa from public.canchas where id = p_cancha) then
    return 'Fuera de servicio';
  end if;
  m := public._bloqueo(p_cancha, p_inicio, p_fin);
  if m is not null then return m; end if;
  if exists (select 1 from public.reservas r
             where r.cancha_id = p_cancha and r.estado = 'activa'
               and tstzrange(r.inicio, r.fin) && tstzrange(p_inicio, p_fin)) then
    return 'Reservada';
  end if;
  return null;
end $$;

-- Momento en que se habilitan los turnos de una fecha
create or replace function public._habilita_en(p_fecha date) returns timestamptz
language sql stable security definer set search_path = public as $$
  select public._instante(p_fecha - c.dias_anticipacion, c.hora_habilitacion)
  from public.config c limit 1;
$$;

create or replace function public._minutos(p_tipo text) returns int
language sql immutable as $$
  select case p_tipo when 'single' then 60 when 'dobles' then 90 end;
$$;

-- =====================================================================
-- API para la web (RPC)
-- =====================================================================

-- Login: número de socio + DNI. Bloquea 15 min tras 5 intentos fallidos.
create or replace function public.login(p_nro text, p_dni text) returns json
language plpgsql volatile security definer set search_path = public as $$
declare
  v public.socios;
  t uuid;
  v_nro text := regexp_replace(coalesce(p_nro, ''), '\D', '', 'g');
  v_dni text := regexp_replace(coalesce(p_dni, ''), '\D', '', 'g');
begin
  delete from public.sesiones where vence < now();

  select * into v from public.socios where socios.nro = v_nro for update;
  if not found then
    return json_build_object('ok', false, 'error', 'El número de socio o el DNI no coinciden.');
  end if;

  if v.login_bloqueado_hasta is not null and v.login_bloqueado_hasta > now() then
    return json_build_object('ok', false, 'error', 'Demasiados intentos. Probá de nuevo en unos minutos.');
  end if;

  if regexp_replace(v.dni, '\D', '', 'g') <> v_dni then
    update public.socios
       set login_fallas = case when login_fallas + 1 >= 5 then 0 else login_fallas + 1 end,
           login_bloqueado_hasta = case when login_fallas + 1 >= 5 then now() + interval '15 minutes' else login_bloqueado_hasta end
     where socios.nro = v.nro;
    return json_build_object('ok', false, 'error', 'El número de socio o el DNI no coinciden.');
  end if;

  if v.rol <> 'capitania' and not public._carnet_ok(v) then
    return json_build_object('ok', false, 'error',
      'Tu carnet de tenis no figura vigente. Consultá en la Capitanía de Tenis.');
  end if;

  update public.socios set login_fallas = 0, login_bloqueado_hasta = null where socios.nro = v.nro;
  insert into public.sesiones (socio_nro) values (v.nro) returning token into t;

  return json_build_object('ok', true, 'token', t, 'nro', v.nro,
                           'nombre', public._nombre(v), 'rol', v.rol);
end $$;

create or replace function public.logout(p_token uuid) returns void
language sql volatile security definer set search_path = public as $$
  delete from public.sesiones where token = p_token;
$$;

-- Días que se muestran en la app (hoy + anticipación) con su estado
create or replace function public.dias(p_token uuid) returns json
language plpgsql stable security definer set search_path = public as $$
declare
  s public.socios := public._socio_de_token(p_token);
  c public.config := public._cfg();
  hoy date := public._ahora_local()::date;
begin
  return (
    select json_agg(json_build_object(
      'fecha', d::date,
      'habilitado', now() >= public._habilita_en(d::date),
      'habilita_en', public._habilita_en(d::date)
    ) order by d)
    from generate_series(hoy, hoy + c.dias_anticipacion, interval '1 day') d
  );
end $$;

-- Disponibilidad de una fecha: por cada horario de inicio, canchas libres y ocupadas
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
                                            'libres', libres, 'ocupadas', ocupadas);
      end if;
      t := t + interval '30 minutes';
    end loop;
  end if;

  return json_build_object(
    'fecha', p_fecha,
    'tipo', p_tipo,
    'habilitado', now() >= hab,
    'habilita_en', hab,
    'mi_reserva_activa', public._tiene_reserva_activa(s.nro),
    'slots', array_to_json(slots)
  );
end $$;

-- Buscar compañeros (solo datos mínimos: número, nombre y si puede jugar)
create or replace function public.buscar_socios(p_token uuid, p_q text) returns json
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
               when public._tiene_reserva_activa(o.nro) then 'con_reserva'
               else 'ok'
             end as estado
      from public.socios o
      where o.nro <> s.nro
        and o.activo
        and (o.nro like (q || '%')
             or public._norm(o.nombre || ' ' || o.apellido) like ('%' || public._norm(q) || '%')
             or public._norm(o.apellido || ' ' || o.nombre) like ('%' || public._norm(q) || '%'))
      order by o.apellido, o.nombre
      limit 10
    ) x
  ), '[]'::json);
end $$;

-- Reservar: valida TODO y crea la reserva de forma atómica
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

  -- Una sola reserva activa por socio. Bloqueo por socio (en orden, sin deadlocks)
  todos := array(select x from unnest(todos || s.nro) x order by x);
  foreach n in array todos loop
    perform pg_advisory_xact_lock(hashtext('socio:' || n));
  end loop;
  foreach n in array todos loop
    if public._tiene_reserva_activa(n) then
      select * into j from public.socios where nro = n;
      if n = s.nro then
        raise exception 'Ya tenés una reserva activa. Cancelala para reservar otra.';
      else
        raise exception '% ya tiene una reserva activa.', public._nombre(j);
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

-- Reservas activas por jugar del socio (como titular o jugador)
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
    ) order by r.inicio)
    from public.reservas r
    where r.estado = 'activa' and r.fin > now()
      and exists (select 1 from public.reserva_jugadores rj where rj.reserva_id = r.id and rj.socio_nro = s.nro)
  ), '[]'::json);
end $$;

-- Cancelar: el titular (o la Capitanía) puede cancelar en cualquier momento
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
     set estado = 'cancelada', cancelada = now(), cancelada_por = s.nro
   where id = p_id;
end $$;

-- ---------------------------------------------------------------------
-- Capitanía
-- ---------------------------------------------------------------------
create or replace function public._exigir_capitania(p_token uuid) returns public.socios
language plpgsql stable security definer set search_path = public as $$
declare s public.socios := public._socio_de_token(p_token);
begin
  if s.rol <> 'capitania' then raise exception 'Solo para la Capitanía de Tenis.'; end if;
  return s;
end $$;

-- Grilla del día: cada cancha por media hora (libre / reservada / bloqueada)
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
          select json_build_object('estado', 'reservada', 'reserva_id', r.id, 'detalle',
                   (select string_agg(public._nombre(o), ', ' order by rj.es_titular desc)
                      from public.reserva_jugadores rj join public.socios o on o.nro = rj.socio_nro
                     where rj.reserva_id = r.id))
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

-- Crear bloqueo para varias canchas. Devuelve cuántas reservas activas pisa.
create or replace function public.crear_bloqueo(
  p_token uuid, p_canchas int[], p_fecha date, p_desde time, p_hasta time, p_motivo text, p_semanal boolean
) returns json
language plpgsql volatile security definer set search_path = public as $$
declare
  s public.socios := public._exigir_capitania(p_token);
  k int;
  conflictos int := 0;
begin
  if p_hasta <= p_desde then raise exception 'El horario "hasta" tiene que ser posterior a "desde".'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Falta el motivo.'; end if;
  if coalesce(array_length(p_canchas, 1), 0) = 0 then raise exception 'Elegí al menos una cancha.'; end if;

  foreach k in array p_canchas loop
    if p_semanal then
      insert into public.bloqueos (cancha_id, motivo, dia_semana, hora_desde, hora_hasta, creado_por)
      values (k, trim(p_motivo), extract(dow from p_fecha)::int, p_desde, p_hasta, s.nro);
    else
      insert into public.bloqueos (cancha_id, motivo, inicio, fin, creado_por)
      values (k, trim(p_motivo), public._instante(p_fecha, p_desde), public._instante(p_fecha, p_hasta), s.nro);
    end if;
    select conflictos + count(*) into conflictos from public.reservas r
    where r.cancha_id = k and r.estado = 'activa'
      and tstzrange(r.inicio, r.fin) && tstzrange(public._instante(p_fecha, p_desde), public._instante(p_fecha, p_hasta));
  end loop;

  return json_build_object('ok', true, 'reservas_afectadas', conflictos);
end $$;

create or replace function public.borrar_bloqueo(p_token uuid, p_id uuid) returns void
language plpgsql volatile security definer set search_path = public as $$
declare s public.socios := public._exigir_capitania(p_token);
begin
  delete from public.bloqueos where id = p_id;
end $$;

-- =====================================================================
-- Permisos: la web (rol anon) solo puede ejecutar la API, nada más.
-- =====================================================================
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

grant execute on function public.login(text, text)                                   to anon, authenticated;
grant execute on function public.logout(uuid)                                        to anon, authenticated;
grant execute on function public.dias(uuid)                                          to anon, authenticated;
grant execute on function public.disponibilidad(uuid, date, text)                    to anon, authenticated;
grant execute on function public.buscar_socios(uuid, text)                           to anon, authenticated;
grant execute on function public.reservar(uuid, int, timestamptz, text, text[])      to anon, authenticated;
grant execute on function public.mis_reservas(uuid)                                  to anon, authenticated;
grant execute on function public.cancelar_reserva(uuid, uuid)                        to anon, authenticated;
grant execute on function public.panel_dia(uuid, date)                               to anon, authenticated;
grant execute on function public.crear_bloqueo(uuid, int[], date, time, time, text, boolean) to anon, authenticated;
grant execute on function public.borrar_bloqueo(uuid, uuid)                          to anon, authenticated;
