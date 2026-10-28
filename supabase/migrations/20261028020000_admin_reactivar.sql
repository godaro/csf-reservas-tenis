-- =====================================================================
-- Administración: "Volver a dar de alta" a un socio sin carnet, con los
-- datos que ya tiene su ficha (por ejemplo, si se lo dio de baja por error).
--   * Queda como alta manual: si el Excel siguiente lo trae, pasa a ser uno
--     más; si no lo trae, aparece entre las altas manuales a dar de baja.
-- Se corre en Supabase → SQL Editor.
-- =====================================================================

create or replace function public.admin_reactivar_carnet(p_token uuid, p_nro text) returns json
language plpgsql volatile security definer set search_path = public as $$
declare
  s public.socios := public._exigir_admin(p_token);
  x public.socios;
begin
  select * into x from public.socios where nro = p_nro and rol = 'socio' for update;
  if not found then raise exception 'No encontramos a ese socio.'; end if;
  if public._carnet_ok(x) then raise exception '% ya tiene el carnet vigente.', public._nombre(x); end if;
  if coalesce(x.dni, '') = '' then raise exception 'La ficha no tiene DNI: cargalo con el formulario de alta manual.'; end if;

  update public.socios
     set carnet_tenis = true, activo = true, carnet_vence = null,
         origen = 'manual', alta_manual_en = now(), alta_manual_por = s.nombre,
         login_fallas = 0, login_bloqueado_hasta = null, actualizado = now()
   where nro = p_nro;

  return json_build_object('nro', p_nro, 'nombre', public._nombre(x));
end $$;

revoke all on function public.admin_reactivar_carnet(uuid, text) from public;
grant execute on function public.admin_reactivar_carnet(uuid, text) to anon, authenticated;

notify pgrst, 'reload schema';
