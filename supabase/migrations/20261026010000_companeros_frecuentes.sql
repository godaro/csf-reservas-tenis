-- =====================================================================
-- Compañeros frecuentes: con quién jugó cada socio, para sumarlos con un toque.
-- Se corre en Supabase → SQL Editor (después del esquema inicial).
-- =====================================================================

create index if not exists reserva_jugadores_reserva_idx on public.reserva_jugadores (reserva_id);

-- Hasta 6 compañeros, ordenados por cantidad de partidos juntos y por lo reciente.
-- Cuenta reservas no canceladas (jugadas o por jugar). Cada socio ve solo los suyos.
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
      join public.reservas r            on r.id = yo.reserva_id and r.estado = 'activa'
      join public.reserva_jugadores otro on otro.reserva_id = yo.reserva_id and otro.socio_nro <> yo.socio_nro
      join public.socios o              on o.nro = otro.socio_nro and o.activo
      where yo.socio_nro = s.nro
        and r.inicio > now() - interval '180 days'
      group by o.nro  -- nro es la clave: alcanza para usar el resto de la fila
      order by count(*) desc, max(r.inicio) desc
      limit 6
    ) x
  ), '[]'::json);
end $$;

revoke all on function public.companeros_frecuentes(uuid) from public, anon, authenticated;
grant execute on function public.companeros_frecuentes(uuid) to anon, authenticated;
