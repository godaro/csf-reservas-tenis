-- =====================================================================
-- Administración: lista de mails corregidos por los socios en la app,
-- para actualizarlos en AF Sistemas.
--   * Cuando el Excel semanal ya trae el mismo mail que cargó el socio
--     (AF ya está actualizado), sale de la lista sola.
-- Se corre en Supabase → SQL Editor.
-- =====================================================================

create or replace function public.admin_mails_corregidos(p_token uuid) returns json
language plpgsql stable security definer set search_path = public as $$
declare s public.socios := public._exigir_admin(p_token);
begin
  return coalesce((
    select json_agg(x order by x.cargado_el desc) from (
      select o.nro, o.apellido, o.nombre, o.email_anterior as mail_af, o.email as mail_nuevo,
             o.email_socio_en as cargado_el
      from public.socios o
      where o.rol = 'socio' and o.email_socio_en is not null and not o.prueba
    ) x
  ), '[]'::json);
end $$;

-- Al aplicar el Excel: si AF ya trae el mail que cargó el socio, deja de figurar como pendiente
create or replace function public._padron_mails_al_dia(p_filas jsonb) returns int
language plpgsql volatile security definer set search_path = public as $$
declare n int;
begin
  update public.socios o set email_socio_en = null, email_anterior = null
    from public._padron_filas(p_filas) f
   where f.nro = o.nro and o.email_socio_en is not null and f.email is not null and lower(f.email) = lower(o.email);
  get diagnostics n = row_count;
  return n;
end $$;

-- Mismo admin_aplicar_padron, más el paso anterior
create or replace function public.admin_aplicar_padron(p_token uuid, p_filas jsonb, p_mantener text[] default '{}', p_archivo text default null)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  s public.socios := public._exigir_admin(p_token);
  plan jsonb;
  n_bajas int;
  n_mant int;
  n_mails int;
begin
  perform pg_advisory_xact_lock(hashtext('padron'));
  plan := public._padron_plan(p_filas);
  if (plan->>'filas')::int = 0 then raise exception 'El Excel no trae socios.'; end if;

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

  n_mails := public._padron_mails_al_dia(p_filas);

  select count(*) into n_mant from public.socios o
   where o.rol = 'socio' and not o.prueba and o.carnet_tenis and o.nro = any(coalesce(p_mantener, '{}'))
     and not exists (select 1 from public._padron_filas(p_filas) f where f.nro = o.nro);

  update public.socios o set carnet_tenis = false, actualizado = now()
   where o.rol = 'socio' and not o.prueba and o.carnet_tenis
     and not (o.nro = any(coalesce(p_mantener, '{}')))
     and not exists (select 1 from public._padron_filas(p_filas) f where f.nro = o.nro);
  get diagnostics n_bajas = row_count;

  delete from public.sesiones x using public.socios o
   where x.socio_nro = o.nro and o.rol = 'socio' and not o.carnet_tenis;

  insert into public.padron_cargas (por, archivo, filas, altas, bajas, cambios, mantenidos)
  values (s.nombre, nullif(trim(coalesce(p_archivo, '')), ''), (plan->>'filas')::int,
          jsonb_array_length(plan->'altas'), n_bajas, jsonb_array_length(plan->'cambios'), n_mant);

  return jsonb_build_object('filas', (plan->>'filas')::int, 'altas', jsonb_array_length(plan->'altas'),
                            'bajas', n_bajas, 'cambios', jsonb_array_length(plan->'cambios'),
                            'mantenidos', n_mant, 'mails_al_dia', n_mails);
end $$;

revoke all on function public._padron_mails_al_dia(jsonb) from public, anon, authenticated;
revoke all on function public.admin_mails_corregidos(uuid) from public;
grant execute on function public.admin_mails_corregidos(uuid) to anon, authenticated;
grant execute on function public.admin_aplicar_padron(uuid, jsonb, text[], text) to anon, authenticated;

notify pgrst, 'reload schema';
