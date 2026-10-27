-- =====================================================================
-- Avisos solo a mails con formato válido.
-- El padrón trae mails cortados (ej. "nombre@hotmail."): se guardan tal cual
-- para poder corregirlos, pero no se les manda nada (quedan como "sin_mail").
-- Correr ANTES de cargar el padrón (cargar_padron.sql usa _email_valido).
-- =====================================================================

create or replace function public._email_valido(e text) returns boolean
language sql immutable as $$
  select coalesce(lower(trim(e)) ~ '^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$'
                  and lower(trim(e)) !~ '(^-\.-@|noposee|^contaduria@)', false);
$$;

create or replace function public._encolar_confirmacion() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.avisos (tipo, reserva_id, socio_nro, estado)
  select 'confirmada', new.reserva_id, new.socio_nro,
         case when public._email_valido(s.email) then 'pendiente' else 'sin_mail' end
  from public.socios s
  join public.reservas r on r.id = new.reserva_id
  where s.nro = new.socio_nro
    and r.estado = 'activa' and r.fin > now()
  on conflict do nothing;
  return new;
exception when others then
  raise warning '_encolar_confirmacion: %', sqlerrm;
  return new;
end $$;

create or replace function public._encolar_cancelacion() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.estado = 'activa' and new.estado = 'cancelada' and new.fin > now() then
    -- Si la confirmación todavía no salió, ya no tiene sentido mandarla
    update public.avisos set estado = 'descartado'
     where reserva_id = new.id and tipo = 'confirmada' and estado = 'pendiente';

    insert into public.avisos (tipo, reserva_id, socio_nro, estado)
    select 'cancelada', new.id, rj.socio_nro,
           case when public._email_valido(s.email) then 'pendiente' else 'sin_mail' end
    from public.reserva_jugadores rj
    join public.socios s on s.nro = rj.socio_nro
    where rj.reserva_id = new.id
    on conflict do nothing;
  end if;
  return new;
exception when others then
  raise warning '_encolar_cancelacion: %', sqlerrm;
  return new;
end $$;

revoke all on function public._email_valido(text) from public, anon, authenticated;

-- Avisos pendientes que ya no corresponden (mail inválido)
update public.avisos a set estado = 'sin_mail'
  from public.socios s
 where s.nro = a.socio_nro and a.estado = 'pendiente' and not public._email_valido(s.email);
