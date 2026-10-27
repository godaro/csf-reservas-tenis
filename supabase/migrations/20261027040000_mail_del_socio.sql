-- =====================================================================
-- El socio puede cargar o corregir su propio mail desde la app.
--   * Si no tiene un mail válido, la app le muestra un aviso para cargarlo.
--   * Queda registrado cuándo lo cargó y cuál tenía antes, para que
--     Administración lo actualice también en AF Sistemas.
--   * Al volver a cargar el padrón, el mail que cargó el socio se respeta.
-- Se corre en Supabase → SQL Editor, ANTES de cargar_padron.sql.
--
-- Listado para Administración (mails corregidos por los socios):
--   select nro, apellido, nombre, email_anterior as mail_en_af, email as mail_nuevo,
--          email_socio_en at time zone 'America/Argentina/Buenos_Aires' as cargado_el
--     from socios where email_socio_en is not null order by email_socio_en desc;
-- =====================================================================

alter table public.socios add column if not exists email_socio_en timestamptz;
alter table public.socios add column if not exists email_anterior text;

-- Datos del socio logueado (solo lo suyo)
create or replace function public.mi_perfil(p_token uuid) returns json
language plpgsql stable security definer set search_path = public as $$
declare s public.socios := public._socio_de_token(p_token);
begin
  return json_build_object(
    'nro', s.nro,
    'nombre', public._nombre(s),
    'email', case when public._email_valido(s.email) then lower(trim(s.email)) end,
    'email_valido', public._email_valido(s.email)
  );
end $$;

-- Cargar / corregir el propio mail
create or replace function public.actualizar_mi_email(p_token uuid, p_email text) returns json
language plpgsql volatile security definer set search_path = public as $$
declare
  s public.socios := public._socio_de_token(p_token);
  e text := lower(trim(coalesce(p_email, '')));
begin
  if s.rol <> 'socio' then raise exception 'Solo para socios.'; end if;
  if not public._email_valido(e) then
    raise exception 'Ese mail no parece válido. Revisalo (ej.: nombre@gmail.com).';
  end if;
  if length(e) > 120 then raise exception 'El mail es demasiado largo.'; end if;
  update public.socios
     set email_anterior = case when email_socio_en is null then email else email_anterior end,
         email = e,
         email_socio_en = now(),
         actualizado = now()
   where nro = s.nro;
  return json_build_object('ok', true, 'email', e);
end $$;

revoke all on function public.mi_perfil(uuid) from public;
revoke all on function public.actualizar_mi_email(uuid, text) from public;
grant execute on function public.mi_perfil(uuid) to anon, authenticated;
grant execute on function public.actualizar_mi_email(uuid, text) to anon, authenticated;
