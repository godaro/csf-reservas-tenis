-- =====================================================================
-- Mantenimiento
--   * /mantenimiento: grilla pública de ocupación (libre / en uso /
--     bloqueada), sin nombres de socios.
--   * Usuario "mantenimiento" (solo el encargado): agrega, modifica y borra
--     bloqueos de mantenimiento. No puede pisar reservas (eso lo resuelve la
--     Capitanía) ni tocar los bloqueos de la Capitanía.
--   * Los bloqueos de mantenimiento se ven en otro color, también en el
--     panel de Capitanía.
-- Se corre en Supabase → SQL Editor.
--
-- Crear el usuario del encargado (o resetearle la clave):
--   select crear_usuario_mantenimiento('mantenimiento', 'Mantenimiento', 'clave-temporal-123');
-- =====================================================================

set search_path = public, extensions;

alter table public.socios drop constraint if exists socios_rol_check;
alter table public.socios add constraint socios_rol_check check (rol in ('socio', 'capitania', 'admin', 'mantenimiento'));

create or replace function public._es_mantenimiento(p_motivo text) returns boolean
language sql immutable as $$
  select coalesce(p_motivo ilike 'mantenimiento%', false);
$$;

create or replace function public._exigir_mantenimiento(p_token uuid) returns public.socios
language plpgsql stable security definer set search_path = public as $$
declare s public.socios := public._socio_de_token(p_token);
begin
  if s.rol <> 'mantenimiento' then raise exception 'Solo para el encargado de mantenimiento.'; end if;
  return s;
end $$;

-- Login con usuario y clave: Capitanía, Administración y Mantenimiento
create or replace function public.login_capitania(p_usuario text, p_clave text) returns json
language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  v public.socios;
  t uuid;
  u text := lower(trim(coalesce(p_usuario, '')));
begin
  delete from public.sesiones where vence < now();

  select * into v from public.socios
   where lower(socios.usuario) = u and socios.rol in ('capitania', 'admin', 'mantenimiento') and socios.activo
   for update;
  if not found or v.clave_hash is null then
    perform pg_sleep(0.3);
    return json_build_object('ok', false, 'error', 'El usuario o la clave no coinciden.');
  end if;

  if v.login_bloqueado_hasta is not null and v.login_bloqueado_hasta > now() then
    return json_build_object('ok', false, 'error', 'Demasiados intentos. Probá de nuevo en unos minutos.');
  end if;

  if crypt(coalesce(p_clave, ''), v.clave_hash) <> v.clave_hash then
    update public.socios
       set login_fallas = case when login_fallas + 1 >= 5 then 0 else login_fallas + 1 end,
           login_bloqueado_hasta = case when login_fallas + 1 >= 5 then now() + interval '15 minutes' else login_bloqueado_hasta end
     where socios.nro = v.nro;
    return json_build_object('ok', false, 'error', 'El usuario o la clave no coinciden.');
  end if;

  update public.socios set login_fallas = 0, login_bloqueado_hasta = null where socios.nro = v.nro;
  insert into public.sesiones (socio_nro, vence) values (v.nro, now() + interval '12 hours') returning token into t;

  return json_build_object('ok', true, 'token', t, 'nro', v.nro,
                           'nombre', public._nombre(v), 'rol', v.rol);
end $$;

create or replace function public.cambiar_clave(p_token uuid, p_actual text, p_nueva text) returns void
language plpgsql volatile security definer set search_path = public, extensions as $$
declare s public.socios := public._socio_de_token(p_token);
begin
  if s.rol not in ('capitania', 'admin', 'mantenimiento') then raise exception 'Solo para cuentas con usuario y clave.'; end if;
  if s.clave_hash is null or crypt(coalesce(p_actual, ''), s.clave_hash) <> s.clave_hash then
    raise exception 'La clave actual no es correcta.';
  end if;
  if length(coalesce(p_nueva, '')) < 8 then
    raise exception 'La clave nueva tiene que tener al menos 8 caracteres.';
  end if;
  update public.socios set clave_hash = crypt(p_nueva, gen_salt('bf', 10)) where nro = s.nro;
  delete from public.sesiones where socio_nro = s.nro and token <> p_token;
end $$;

create or replace function public.crear_usuario_mantenimiento(p_usuario text, p_nombre text, p_clave text) returns text
language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  u text := lower(trim(coalesce(p_usuario, '')));
  n text := 'mnt-' || u;
begin
  if u !~ '^[a-z0-9._-]{3,30}$' then
    raise exception 'Usuario inválido: de 3 a 30 letras, números, punto, guion o guion bajo.';
  end if;
  if exists (select 1 from public.socios where lower(usuario) = u and nro <> n) then
    raise exception 'Ese usuario ya existe en otra cuenta.';
  end if;
  if length(coalesce(p_clave, '')) < 8 then
    raise exception 'La clave tiene que tener al menos 8 caracteres.';
  end if;
  insert into public.socios (nro, dni, nombre, apellido, activo, carnet_tenis, rol, usuario, clave_hash)
  values (n, '', coalesce(nullif(trim(p_nombre), ''), 'Mantenimiento'), '', true, false, 'mantenimiento', u,
          crypt(p_clave, gen_salt('bf', 10)))
  on conflict (nro) do update
    set clave_hash = excluded.clave_hash, nombre = excluded.nombre, activo = true,
        login_fallas = 0, login_bloqueado_hasta = null;
  delete from public.sesiones where socio_nro = n;
  return 'Usuario "' || u || '" listo. Entrá en /mantenimiento y cambiá la clave.';
end $$;

-- ---------------------------------------------------------------------
-- Grilla pública de ocupación (sin datos personales)
-- ---------------------------------------------------------------------
create or replace function public.ocupacion_dia(p_fecha date) returns json
language plpgsql stable security definer set search_path = public as $$
declare
  c public.config := public._cfg();
  hoy date := (now() at time zone c.zona)::date;
  horas json;
  filas json;
  bloq json;
begin
  if p_fecha is null or p_fecha < hoy - 31 or p_fecha > hoy + 62 then
    raise exception 'Elegí una fecha entre el mes pasado y los próximos dos meses.';
  end if;

  select json_agg(to_char(h, 'HH24:MI') order by h) into horas
  from generate_series(p_fecha + c.hora_apertura, p_fecha + c.hora_cierre - interval '30 minutes', interval '30 minutes') h;

  select json_agg(json_build_object('cancha', k.id, 'celdas', (
    select json_agg(
      case
        when m.motivo is not null
          then json_build_object('estado', 'bloqueada', 'detalle', m.motivo, 'mantenimiento', public._es_mantenimiento(m.motivo))
        when exists (select 1 from public.reservas r
                      where r.cancha_id = k.id and r.estado = 'activa'
                        and tstzrange(r.inicio, r.fin) && tstzrange(x.ini, x.ini + interval '30 minutes'))
          then json_build_object('estado', 'reservada', 'detalle', 'En uso')
        else json_build_object('estado', 'libre')
      end order by x.h)
    from (select h, public._instante(p_fecha, h::time) as ini
            from generate_series(p_fecha + c.hora_apertura, p_fecha + c.hora_cierre - interval '30 minutes', interval '30 minutes') h) x
    cross join lateral (select public._bloqueo(k.id, x.ini, x.ini + interval '30 minutes') as motivo) m
  )) order by k.id) into filas
  from public.canchas k;

  select json_agg(json_build_object(
           'id', b.id, 'cancha', b.cancha_id, 'motivo', b.motivo, 'mantenimiento', public._es_mantenimiento(b.motivo),
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

-- ---------------------------------------------------------------------
-- Bloqueos de mantenimiento (solo el encargado)
-- ---------------------------------------------------------------------
-- Crea un bloqueo de mantenimiento, o lo modifica si p_reemplaza trae los ids del anterior.
-- Si pisa alguna reserva, no lo deja: eso lo resuelve la Capitanía.
create or replace function public.mantenimiento_guardar_bloqueo(
  p_token uuid, p_canchas int[], p_fecha date, p_desde time, p_hasta time, p_semanal boolean,
  p_detalle text default null, p_reemplaza uuid[] default '{}'
) returns json
language plpgsql volatile security definer set search_path = public as $$
declare
  s public.socios := public._exigir_mantenimiento(p_token);
  k int;
  det text := nullif(trim(coalesce(p_detalle, '')), '');
  v_motivo text;
  conflictos json;
begin
  if p_hasta <= p_desde then raise exception 'El horario "hasta" tiene que ser posterior a "desde".'; end if;
  if coalesce(array_length(p_canchas, 1), 0) = 0 then raise exception 'Elegí al menos una cancha.'; end if;
  if det is not null and length(det) > 60 then raise exception 'El detalle es muy largo (máximo 60 caracteres).'; end if;
  v_motivo := 'Mantenimiento' || coalesce(' · ' || det, '');

  if coalesce(array_length(p_reemplaza, 1), 0) > 0 then
    if exists (select 1 from public.bloqueos b where b.id = any (p_reemplaza) and not public._es_mantenimiento(b.motivo)) then
      raise exception 'Solo se pueden modificar bloqueos de mantenimiento.';
    end if;
    delete from public.bloqueos b where b.id = any (p_reemplaza) and public._es_mantenimiento(b.motivo);
  end if;

  select json_agg(json_build_object('cancha', r.cancha_id,
           'fecha', to_char(r.inicio at time zone (select zona from public.config limit 1), 'DD/MM'),
           'hora', to_char(r.inicio at time zone (select zona from public.config limit 1), 'HH24:MI')) order by r.inicio, r.cancha_id)
    into conflictos
  from public._reservas_afectadas(p_canchas, p_fecha, p_desde, p_hasta, p_semanal) r;
  if conflictos is not null then
    raise exception 'Ese bloqueo pisa % reserva(s) de socios (%). Coordiná con la Capitanía para mover o cancelar esos partidos.',
      json_array_length(conflictos),
      (select string_agg('cancha ' || (x->>'cancha') || ' el ' || (x->>'fecha') || ' a las ' || (x->>'hora'), ', ')
         from json_array_elements(conflictos) x)
      using hint = 'CONFLICTO';
  end if;

  foreach k in array p_canchas loop
    if p_semanal then
      insert into public.bloqueos (cancha_id, motivo, dia_semana, hora_desde, hora_hasta, creado_por)
      values (k, v_motivo, extract(dow from p_fecha)::int, p_desde, p_hasta, s.nro);
    else
      insert into public.bloqueos (cancha_id, motivo, inicio, fin, creado_por)
      values (k, v_motivo, public._instante(p_fecha, p_desde), public._instante(p_fecha, p_hasta), s.nro);
    end if;
  end loop;
  return json_build_object('ok', true, 'motivo', v_motivo);
end $$;

create or replace function public.mantenimiento_borrar_bloqueo(p_token uuid, p_ids uuid[]) returns json
language plpgsql volatile security definer set search_path = public as $$
declare
  s public.socios := public._exigir_mantenimiento(p_token);
  n int;
begin
  if exists (select 1 from public.bloqueos where id = any (p_ids) and not public._es_mantenimiento(motivo)) then
    raise exception 'Solo se pueden borrar bloqueos de mantenimiento.';
  end if;
  delete from public.bloqueos where id = any (p_ids) and public._es_mantenimiento(motivo);
  get diagnostics n = row_count;
  return json_build_object('borrados', n);
end $$;

-- Panel de Capitanía: marca los bloqueos de mantenimiento (para verlos en otro color)
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
          then json_build_object('estado', 'bloqueada',
            'mantenimiento', public._es_mantenimiento(public._bloqueo(k.id, public._instante(p_fecha, h::time), public._instante(p_fecha, h::time) + interval '30 minutes')),
            'detalle', public._bloqueo(k.id, public._instante(p_fecha, h::time), public._instante(p_fecha, h::time) + interval '30 minutes'))
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
           'id', b.id, 'cancha', b.cancha_id, 'motivo', b.motivo, 'mantenimiento', public._es_mantenimiento(b.motivo),
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

revoke all on function public._exigir_mantenimiento(uuid) from public, anon, authenticated;
revoke all on function public.crear_usuario_mantenimiento(text, text, text) from public, anon, authenticated;
revoke all on function public.ocupacion_dia(date) from public;
revoke all on function public.mantenimiento_guardar_bloqueo(uuid, int[], date, time, time, boolean, text, uuid[]) from public;
revoke all on function public.mantenimiento_borrar_bloqueo(uuid, uuid[]) from public;
grant execute on function public.ocupacion_dia(date) to anon, authenticated;
grant execute on function public.mantenimiento_guardar_bloqueo(uuid, int[], date, time, time, boolean, text, uuid[]) to anon, authenticated;
grant execute on function public.mantenimiento_borrar_bloqueo(uuid, uuid[]) to anon, authenticated;
grant execute on function public.login_capitania(text, text) to anon, authenticated;
grant execute on function public.cambiar_clave(uuid, text, text) to anon, authenticated;
grant execute on function public.panel_dia(uuid, date) to anon, authenticated;

notify pgrst, 'reload schema';
