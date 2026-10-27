-- =====================================================================
-- Capitanía con usuario y clave
--   * Las cuentas de Capitanía entran al panel (/capitania) con usuario y
--     clave (guardada cifrada con bcrypt). Ya no con número de socio + DNI.
--   * Las cuentas de Capitanía no aparecen como compañeros, no figuran en
--     "Jugaste con" y no pueden jugar ni reservar.
--   * Desde el panel cada usuario puede cambiar su clave.
-- Se corre en Supabase → SQL Editor.
--
-- Crear un usuario (o resetearle la clave) — desde el SQL Editor:
--   select crear_usuario_capitania('capitania', 'Capitanía de Tenis', 'clave-temporal-123');
-- Después la persona entra al panel y la cambia en "Cambiar clave".
-- =====================================================================

set search_path = public, extensions;

alter table public.socios add column if not exists usuario text unique;
alter table public.socios add column if not exists clave_hash text;

-- Solo los socios comunes pueden jugar
create or replace function public._carnet_ok(s public.socios) returns boolean
language sql stable security definer set search_path = public as $$
  select s.rol = 'socio' and s.activo and s.carnet_tenis
     and (s.carnet_vence is null or s.carnet_vence >= public._ahora_local()::date);
$$;

-- ---------------------------------------------------------------------
-- Login de socios (número + DNI): las cuentas de Capitanía ya no entran por acá
-- ---------------------------------------------------------------------
create or replace function public.login(p_nro text, p_dni text) returns json
language plpgsql volatile security definer set search_path = public as $$
declare
  v public.socios;
  t uuid;
  v_nro text := regexp_replace(coalesce(p_nro, ''), '\D', '', 'g');
  v_dni text := regexp_replace(coalesce(p_dni, ''), '\D', '', 'g');
begin
  delete from public.sesiones where vence < now();

  select * into v from public.socios where socios.nro = v_nro and socios.rol = 'socio' for update;
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

  if not public._carnet_ok(v) then
    return json_build_object('ok', false, 'error',
      'Tu carnet de tenis no figura vigente. Consultá en la Capitanía de Tenis.');
  end if;

  update public.socios set login_fallas = 0, login_bloqueado_hasta = null where socios.nro = v.nro;
  insert into public.sesiones (socio_nro) values (v.nro) returning token into t;

  return json_build_object('ok', true, 'token', t, 'nro', v.nro,
                           'nombre', public._nombre(v), 'rol', v.rol);
end $$;

-- ---------------------------------------------------------------------
-- Login de Capitanía (usuario + clave)
-- ---------------------------------------------------------------------
create or replace function public.login_capitania(p_usuario text, p_clave text) returns json
language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  v public.socios;
  t uuid;
  u text := lower(trim(coalesce(p_usuario, '')));
begin
  delete from public.sesiones where vence < now();

  select * into v from public.socios
   where lower(socios.usuario) = u and socios.rol = 'capitania' and socios.activo
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

-- Cambiar la propia clave (desde el panel)
create or replace function public.cambiar_clave(p_token uuid, p_actual text, p_nueva text) returns void
language plpgsql volatile security definer set search_path = public, extensions as $$
declare s public.socios := public._exigir_capitania(p_token);
begin
  if s.clave_hash is null or crypt(coalesce(p_actual, ''), s.clave_hash) <> s.clave_hash then
    raise exception 'La clave actual no es correcta.';
  end if;
  if length(coalesce(p_nueva, '')) < 8 then
    raise exception 'La clave nueva tiene que tener al menos 8 caracteres.';
  end if;
  update public.socios set clave_hash = crypt(p_nueva, gen_salt('bf', 10)) where nro = s.nro;
  -- Cierra las demás sesiones abiertas de ese usuario
  delete from public.sesiones where socio_nro = s.nro and token <> p_token;
end $$;

-- Crear usuario de Capitanía o resetear su clave (solo desde el SQL Editor)
create or replace function public.crear_usuario_capitania(p_usuario text, p_nombre text, p_clave text) returns text
language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  u text := lower(trim(coalesce(p_usuario, '')));
  n text := 'cap-' || u;
begin
  if u !~ '^[a-z0-9._-]{3,30}$' then
    raise exception 'Usuario inválido: de 3 a 30 letras, números, punto, guion o guion bajo.';
  end if;
  if length(coalesce(p_clave, '')) < 8 then
    raise exception 'La clave tiene que tener al menos 8 caracteres.';
  end if;
  insert into public.socios (nro, dni, nombre, apellido, activo, carnet_tenis, rol, usuario, clave_hash)
  values (n, '', coalesce(nullif(trim(p_nombre), ''), 'Capitanía de Tenis'), '', true, false, 'capitania', u,
          crypt(p_clave, gen_salt('bf', 10)))
  on conflict (nro) do update
    set clave_hash = excluded.clave_hash, nombre = excluded.nombre, activo = true,
        login_fallas = 0, login_bloqueado_hasta = null;
  delete from public.sesiones where socio_nro = n;
  return 'Usuario "' || u || '" listo. Entrá en /capitania y cambiá la clave.';
end $$;

-- ---------------------------------------------------------------------
-- Las cuentas de Capitanía nunca aparecen como compañeros
-- ---------------------------------------------------------------------
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
        and o.rol = 'socio'
        and (o.nro like (q || '%')
             or public._norm(o.nombre || ' ' || o.apellido) like ('%' || public._norm(q) || '%')
             or public._norm(o.apellido || ' ' || o.nombre) like ('%' || public._norm(q) || '%'))
      order by o.apellido, o.nombre
      limit 10
    ) x
  ), '[]'::json);
end $$;

create or replace function public.companeros_frecuentes(p_token uuid) returns json
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
               when public._tiene_reserva_activa(o.nro) then 'con_reserva'
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

-- ---------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------
revoke all on function public.login_capitania(text, text) from public;
revoke all on function public.cambiar_clave(uuid, text, text) from public;
revoke all on function public.crear_usuario_capitania(text, text, text) from public, anon, authenticated;
grant execute on function public.login_capitania(text, text) to anon, authenticated;
grant execute on function public.cambiar_clave(uuid, text, text) to anon, authenticated;
grant execute on function public.login(text, text) to anon, authenticated;
grant execute on function public.buscar_socios(uuid, text) to anon, authenticated;
grant execute on function public.companeros_frecuentes(uuid) to anon, authenticated;
