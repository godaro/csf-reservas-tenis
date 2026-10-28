-- =====================================================================
-- Usuario "admin": sección Socios (en /admin)
--   * Sube el Excel semanal de AF Sistemas con los socios con carnet de
--     tenis vigente. El Excel trae siempre a TODOS los activos: quien no
--     está, pierde el carnet (salvo que el admin lo mantenga a mano).
--   * Altas manuales para quien paga el carnet en la semana: puede
--     reservar en el momento. Cuando llega en el Excel queda como uno más;
--     si no llega, la carga siguiente lo da de baja (se puede mantener).
--   * Buscar socios y dar de baja el carnet.
--   * Los socios de prueba (prueba = true) no se tocan con las cargas.
-- Se corre en Supabase → SQL Editor.
--
-- Crear el usuario (o resetearle la clave), desde el SQL Editor:
--   select crear_usuario_admin('admin', 'Administración', 'clave-temporal-123');
-- =====================================================================

set search_path = public, extensions;

alter table public.socios drop constraint if exists socios_rol_check;
alter table public.socios add constraint socios_rol_check check (rol in ('socio', 'capitania', 'admin'));

alter table public.socios add column if not exists origen text not null default 'padron';
alter table public.socios drop constraint if exists socios_origen_check;
alter table public.socios add constraint socios_origen_check check (origen in ('padron', 'manual'));
alter table public.socios add column if not exists alta_manual_en timestamptz;
alter table public.socios add column if not exists alta_manual_por text;
alter table public.socios add column if not exists prueba boolean not null default false;

-- Socios de prueba (se borran antes del lanzamiento)
update public.socios set prueba = true
 where rol = 'socio' and (nro ~ '^99[0-9]{3}$' or nro in ('98652', '41400'));

-- Historial de cargas del padrón
create table if not exists public.padron_cargas (
  id        bigserial primary key,
  cargado   timestamptz not null default now(),
  por       text not null,
  archivo   text,
  filas     int  not null,
  altas     int  not null,
  bajas     int  not null,
  cambios   int  not null,
  mantenidos int not null default 0
);
alter table public.padron_cargas enable row level security;
revoke all on public.padron_cargas from anon, authenticated;

-- ---------------------------------------------------------------------
-- Accesos
-- ---------------------------------------------------------------------
create or replace function public._exigir_admin(p_token uuid) returns public.socios
language plpgsql stable security definer set search_path = public as $$
declare s public.socios := public._socio_de_token(p_token);
begin
  if s.rol <> 'admin' then raise exception 'Solo para Administración.'; end if;
  return s;
end $$;

-- Capitanía y Administración entran con usuario y clave
create or replace function public.login_capitania(p_usuario text, p_clave text) returns json
language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  v public.socios;
  t uuid;
  u text := lower(trim(coalesce(p_usuario, '')));
begin
  delete from public.sesiones where vence < now();

  select * into v from public.socios
   where lower(socios.usuario) = u and socios.rol in ('capitania', 'admin') and socios.activo
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
  if s.rol not in ('capitania', 'admin') then raise exception 'Solo para cuentas con usuario y clave.'; end if;
  if s.clave_hash is null or crypt(coalesce(p_actual, ''), s.clave_hash) <> s.clave_hash then
    raise exception 'La clave actual no es correcta.';
  end if;
  if length(coalesce(p_nueva, '')) < 8 then
    raise exception 'La clave nueva tiene que tener al menos 8 caracteres.';
  end if;
  update public.socios set clave_hash = crypt(p_nueva, gen_salt('bf', 10)) where nro = s.nro;
  delete from public.sesiones where socio_nro = s.nro and token <> p_token;
end $$;

create or replace function public.crear_usuario_admin(p_usuario text, p_nombre text, p_clave text) returns text
language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  u text := lower(trim(coalesce(p_usuario, '')));
  n text := 'adm-' || u;
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
  values (n, '', coalesce(nullif(trim(p_nombre), ''), 'Administración'), '', true, false, 'admin', u,
          crypt(p_clave, gen_salt('bf', 10)))
  on conflict (nro) do update
    set clave_hash = excluded.clave_hash, nombre = excluded.nombre, activo = true,
        login_fallas = 0, login_bloqueado_hasta = null;
  delete from public.sesiones where socio_nro = n;
  return 'Usuario "' || u || '" listo. Entrá en /admin y cambiá la clave.';
end $$;

-- ---------------------------------------------------------------------
-- Ayudas
-- ---------------------------------------------------------------------
-- Filas del Excel (ya limpiadas en el navegador), una por número de socio
create or replace function public._padron_filas(p_filas jsonb)
returns table (nro text, dni text, nombre text, apellido text, email text, celular text)
language sql immutable as $$
  select distinct on (x.nro) x.nro, x.dni, x.nombre, x.apellido, x.email, x.celular
  from (
    select regexp_replace(coalesce(f.nro, ''), '\D', '', 'g') as nro,
           regexp_replace(coalesce(f.dni, ''), '\D', '', 'g') as dni,
           trim(coalesce(f.nombre, '')) as nombre,
           trim(coalesce(f.apellido, '')) as apellido,
           nullif(lower(trim(coalesce(f.email, ''))), '') as email,
           nullif(trim(coalesce(f.celular, '')), '') as celular
    from jsonb_to_recordset(coalesce(p_filas, '[]'::jsonb))
         as f(nro text, dni text, nombre text, apellido text, email text, celular text)
  ) x
  where x.nro <> ''
  order by x.nro;
$$;

-- Qué mail queda: el que cargó el socio en la app (si es válido) > el del Excel (si es válido) > el que había
create or replace function public._mail_resultante(p_actual public.socios, p_nuevo text) returns text
language sql stable security definer set search_path = public as $$
  select case
    when p_actual.nro is null then p_nuevo
    when p_actual.email_socio_en is not null and public._email_valido(p_actual.email) then p_actual.email
    when public._email_valido(p_nuevo) then p_nuevo
    when public._email_valido(p_actual.email) then p_actual.email
    else coalesce(p_nuevo, p_actual.email)
  end;
$$;

-- Plan de la carga: qué pasaría con este Excel (no cambia nada)
create or replace function public._padron_plan(p_filas jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  r jsonb;
begin
  with f as (select * from public._padron_filas(p_filas)),
  cruce as (
    select f.*, s as actual, (s.nro is not null) as existe,
           (s.nro is not null and public._carnet_ok(s)) as tenia_carnet,
           public._mail_resultante(s, f.email) as mail_final
    from f left join public.socios s on s.nro = f.nro
  ),
  altas as (
    select nro, trim(nombre || ' ' || apellido) as nombre, existe from cruce
    where not tenia_carnet and (actual).rol is distinct from 'capitania' and (actual).rol is distinct from 'admin'
  ),
  confirmados as (
    select nro, trim(nombre || ' ' || apellido) as nombre from cruce where tenia_carnet and (actual).origen = 'manual'
  ),
  cambios as (
    select nro, trim(nombre || ' ' || apellido) as nombre,
           array_remove(array[
             case when (actual).dni is distinct from dni then 'DNI' end,
             case when (actual).nombre is distinct from nombre or (actual).apellido is distinct from apellido then 'nombre' end,
             case when (actual).email is distinct from mail_final then 'mail' end,
             case when celular is not null and (actual).celular is distinct from celular then 'celular' end
           ], null) as campos
    from cruce where tenia_carnet
  ),
  bajas as (
    select s.nro, public._nombre(s) as nombre, s.origen, s.alta_manual_en,
           (select count(*) from public.reserva_jugadores rj join public.reservas rr on rr.id = rj.reserva_id
             where rj.socio_nro = s.nro and rr.estado = 'activa' and rr.fin > now()) as reservas
    from public.socios s
    where s.rol = 'socio' and not s.prueba and s.carnet_tenis
      and not exists (select 1 from f where f.nro = s.nro)
  ),
  invalidos as (
    select nro, trim(nombre || ' ' || apellido) as nombre, coalesce(mail_final, '') as email
    from cruce where not public._email_valido(mail_final)
  ),
  dni_rep as (
    select dni, array_agg(nro order by nro) as nros from f where dni <> '' group by dni having count(*) > 1
  )
  select jsonb_build_object(
    'filas',        (select count(*) from f),
    'con_carnet',   (select count(*) from public.socios s where s.rol = 'socio' and not s.prueba and public._carnet_ok(s)),
    'altas',        coalesce((select jsonb_agg(jsonb_build_object('nro', nro, 'nombre', nombre, 'nuevo', not existe) order by nombre) from altas), '[]'),
    'confirmados',  coalesce((select jsonb_agg(jsonb_build_object('nro', nro, 'nombre', nombre) order by nombre) from confirmados), '[]'),
    'cambios',      coalesce((select jsonb_agg(jsonb_build_object('nro', nro, 'nombre', nombre, 'campos', campos) order by nombre) from cambios where cardinality(campos) > 0), '[]'),
    'bajas',        coalesce((select jsonb_agg(jsonb_build_object('nro', nro, 'nombre', nombre, 'manual', origen = 'manual',
                                'alta_manual_en', alta_manual_en, 'reservas', reservas) order by origen = 'manual' desc, nombre) from bajas), '[]'),
    'mails_invalidos', coalesce((select jsonb_agg(jsonb_build_object('nro', nro, 'nombre', nombre, 'email', email) order by nombre) from invalidos), '[]'),
    'dni_repetidos', coalesce((select jsonb_agg(jsonb_build_object('dni', dni, 'nros', nros)) from dni_rep), '[]')
  ) into r;
  return r;
end $$;

-- ---------------------------------------------------------------------
-- API del admin
-- ---------------------------------------------------------------------
create or replace function public.admin_resumen(p_token uuid) returns json
language plpgsql stable security definer set search_path = public as $$
declare s public.socios := public._exigir_admin(p_token);
begin
  return json_build_object(
    'con_carnet', (select count(*) from public.socios o where o.rol = 'socio' and not o.prueba and public._carnet_ok(o)),
    'manuales',   (select count(*) from public.socios o where o.rol = 'socio' and not o.prueba and o.origen = 'manual' and public._carnet_ok(o)),
    'sin_mail',   (select count(*) from public.socios o where o.rol = 'socio' and not o.prueba and public._carnet_ok(o) and not public._email_valido(o.email)),
    'ultima',     (select json_build_object('cargado', c.cargado, 'por', c.por, 'archivo', c.archivo, 'filas', c.filas,
                                            'altas', c.altas, 'bajas', c.bajas, 'cambios', c.cambios)
                   from public.padron_cargas c order by c.id desc limit 1)
  );
end $$;

create or replace function public.admin_previsualizar_padron(p_token uuid, p_filas jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s public.socios := public._exigir_admin(p_token);
begin
  return public._padron_plan(p_filas);
end $$;

create or replace function public.admin_aplicar_padron(p_token uuid, p_filas jsonb, p_mantener text[] default '{}', p_archivo text default null)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  s public.socios := public._exigir_admin(p_token);
  plan jsonb;
  n_bajas int;
  n_mant int;
begin
  perform pg_advisory_xact_lock(hashtext('padron'));
  plan := public._padron_plan(p_filas);
  if (plan->>'filas')::int = 0 then raise exception 'El Excel no trae socios.'; end if;

  -- Altas y actualizaciones
  insert into public.socios as o (nro, dni, nombre, apellido, email, celular, activo, carnet_tenis, carnet_vence, rol, origen)
  select f.nro, f.dni, f.nombre, f.apellido, f.email, f.celular, true, true, null, 'socio', 'padron'
  from public._padron_filas(p_filas) f
  left join public.socios x on x.nro = f.nro
  where x.nro is null or x.rol = 'socio'
  on conflict (nro) do update
    set dni = excluded.dni,
        nombre = excluded.nombre,
        apellido = excluded.apellido,
        email = public._mail_resultante(o, excluded.email),
        celular = coalesce(excluded.celular, o.celular),
        activo = true, carnet_tenis = true, carnet_vence = null,
        origen = 'padron', alta_manual_en = null, alta_manual_por = null,
        actualizado = now();

  -- Bajas: quienes ya no vienen en el Excel (salvo los que el admin mantiene)
  select count(*) into n_mant from public.socios o
   where o.rol = 'socio' and not o.prueba and o.carnet_tenis and o.nro = any(coalesce(p_mantener, '{}'))
     and not exists (select 1 from public._padron_filas(p_filas) f where f.nro = o.nro);

  update public.socios o set carnet_tenis = false, actualizado = now()
   where o.rol = 'socio' and not o.prueba and o.carnet_tenis
     and not (o.nro = any(coalesce(p_mantener, '{}')))
     and not exists (select 1 from public._padron_filas(p_filas) f where f.nro = o.nro);
  get diagnostics n_bajas = row_count;

  -- Los que perdieron el carnet salen de la app
  delete from public.sesiones x using public.socios o
   where x.socio_nro = o.nro and o.rol = 'socio' and not o.carnet_tenis;

  insert into public.padron_cargas (por, archivo, filas, altas, bajas, cambios, mantenidos)
  values (s.nombre, nullif(trim(coalesce(p_archivo, '')), ''), (plan->>'filas')::int,
          jsonb_array_length(plan->'altas'), n_bajas, jsonb_array_length(plan->'cambios'), n_mant);

  return jsonb_build_object('filas', (plan->>'filas')::int, 'altas', jsonb_array_length(plan->'altas'),
                            'bajas', n_bajas, 'cambios', jsonb_array_length(plan->'cambios'), 'mantenidos', n_mant);
end $$;

create or replace function public.admin_buscar_socios(p_token uuid, p_q text) returns json
language plpgsql stable security definer set search_path = public as $$
declare
  s public.socios := public._exigir_admin(p_token);
  q text := trim(coalesce(p_q, ''));
begin
  return coalesce((
    select json_agg(x) from (
      select o.nro, o.nombre, o.apellido, o.dni, o.email, o.celular, o.origen, o.alta_manual_en, o.prueba,
             public._carnet_ok(o) as carnet, public._email_valido(o.email) as mail_ok
      from public.socios o
      where o.rol = 'socio'
        and (
          (q = '' and o.origen = 'manual' and o.carnet_tenis)
          or (length(q) >= 2 and (o.nro like (q || '%') or o.dni like (q || '%')
               or public._norm(o.nombre || ' ' || o.apellido) like ('%' || public._norm(q) || '%')
               or public._norm(o.apellido || ' ' || o.nombre) like ('%' || public._norm(q) || '%')))
        )
      order by public._carnet_ok(o) desc, o.apellido, o.nombre
      limit 30
    ) x
  ), '[]'::json);
end $$;

create or replace function public.admin_alta_manual(
  p_token uuid, p_nro text, p_dni text, p_nombre text, p_apellido text, p_email text default null, p_celular text default null
) returns json
language plpgsql volatile security definer set search_path = public as $$
declare
  s public.socios := public._exigir_admin(p_token);
  v_nro text := regexp_replace(coalesce(p_nro, ''), '\D', '', 'g');
  v_dni text := regexp_replace(coalesce(p_dni, ''), '\D', '', 'g');
  v_mail text := nullif(lower(trim(coalesce(p_email, ''))), '');
  x public.socios;
begin
  if v_nro = '' then raise exception 'Falta el número de socio.'; end if;
  if length(v_dni) < 6 then raise exception 'El DNI no es válido.'; end if;
  if trim(coalesce(p_nombre, '')) = '' or trim(coalesce(p_apellido, '')) = '' then
    raise exception 'Completá nombre y apellido.';
  end if;
  if v_mail is not null and not public._email_valido(v_mail) then raise exception 'El mail no es válido.'; end if;

  select * into x from public.socios where nro = v_nro;
  if found and x.rol <> 'socio' then raise exception 'Ese número no corresponde a un socio.'; end if;
  if found and public._carnet_ok(x) then
    raise exception '% ya figura con carnet de tenis vigente.', public._nombre(x);
  end if;

  insert into public.socios as o (nro, dni, nombre, apellido, email, celular, activo, carnet_tenis, carnet_vence, rol,
                                  origen, alta_manual_en, alta_manual_por)
  values (v_nro, v_dni, trim(p_nombre), trim(p_apellido), v_mail, nullif(trim(coalesce(p_celular, '')), ''),
          true, true, null, 'socio', 'manual', now(), s.nombre)
  on conflict (nro) do update
    set dni = excluded.dni, nombre = excluded.nombre, apellido = excluded.apellido,
        email = coalesce(excluded.email, o.email), celular = coalesce(excluded.celular, o.celular),
        activo = true, carnet_tenis = true, carnet_vence = null,
        origen = 'manual', alta_manual_en = now(), alta_manual_por = s.nombre,
        login_fallas = 0, login_bloqueado_hasta = null, actualizado = now();

  return json_build_object('nro', v_nro, 'nombre', trim(p_nombre) || ' ' || trim(p_apellido));
end $$;

create or replace function public.admin_baja_carnet(p_token uuid, p_nro text) returns json
language plpgsql volatile security definer set search_path = public as $$
declare
  s public.socios := public._exigir_admin(p_token);
  x public.socios;
begin
  select * into x from public.socios where nro = p_nro and rol = 'socio';
  if not found then raise exception 'No encontramos a ese socio.'; end if;
  update public.socios set carnet_tenis = false, actualizado = now() where nro = p_nro;
  delete from public.sesiones where socio_nro = p_nro;
  return json_build_object('nro', p_nro, 'nombre', public._nombre(x));
end $$;

-- ---------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------
revoke all on function public._exigir_admin(uuid) from public, anon, authenticated;
revoke all on function public._padron_filas(jsonb) from public, anon, authenticated;
revoke all on function public._mail_resultante(public.socios, text) from public, anon, authenticated;
revoke all on function public._padron_plan(jsonb) from public, anon, authenticated;
revoke all on function public.crear_usuario_admin(text, text, text) from public, anon, authenticated;
revoke all on function public.admin_resumen(uuid) from public;
revoke all on function public.admin_previsualizar_padron(uuid, jsonb) from public;
revoke all on function public.admin_aplicar_padron(uuid, jsonb, text[], text) from public;
revoke all on function public.admin_buscar_socios(uuid, text) from public;
revoke all on function public.admin_alta_manual(uuid, text, text, text, text, text, text) from public;
revoke all on function public.admin_baja_carnet(uuid, text) from public;
grant execute on function public.login_capitania(text, text) to anon, authenticated;
grant execute on function public.cambiar_clave(uuid, text, text) to anon, authenticated;
grant execute on function public.admin_resumen(uuid) to anon, authenticated;
grant execute on function public.admin_previsualizar_padron(uuid, jsonb) to anon, authenticated;
grant execute on function public.admin_aplicar_padron(uuid, jsonb, text[], text) to anon, authenticated;
grant execute on function public.admin_buscar_socios(uuid, text) to anon, authenticated;
grant execute on function public.admin_alta_manual(uuid, text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.admin_baja_carnet(uuid, text) to anon, authenticated;

notify pgrst, 'reload schema';
