-- El buscador de compañeros y "Jugaste con" no muestran:
--  * al propio socio (tampoco otra ficha con el mismo DNI)
--  * a quien ya tiene el máximo de reservas activas
create or replace function public.buscar_socios(p_token uuid, p_q text, p_inicio timestamptz default null, p_fin timestamptz default null) returns json
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
               when public._impide_reservar(o.nro, p_inicio, p_fin) = 'limite' then 'con_reserva'
               when public._impide_reservar(o.nro, p_inicio, p_fin) = 'cerca' then 'muy_cerca'
               else 'ok'
             end as estado
      from public.socios o
      where o.nro <> s.nro
        and o.dni <> s.dni
        and coalesce(public._impide_reservar(o.nro, p_inicio, p_fin), '') <> 'limite'
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

create or replace function public.companeros_frecuentes(p_token uuid, p_inicio timestamptz default null, p_fin timestamptz default null) returns json
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
               when public._impide_reservar(o.nro, p_inicio, p_fin) = 'limite' then 'con_reserva'
               when public._impide_reservar(o.nro, p_inicio, p_fin) = 'cerca' then 'muy_cerca'
               else 'ok'
             end as estado
      from public.reserva_jugadores yo
      join public.reservas r             on r.id = yo.reserva_id and r.estado = 'activa'
      join public.reserva_jugadores otro on otro.reserva_id = yo.reserva_id and otro.socio_nro <> yo.socio_nro
      join public.socios o               on o.nro = otro.socio_nro and o.activo and o.rol = 'socio'
      where yo.socio_nro = s.nro
        and o.dni <> s.dni
        and coalesce(public._impide_reservar(o.nro, p_inicio, p_fin), '') <> 'limite'
        and r.inicio > now() - interval '180 days'
      group by o.nro
      order by count(*) desc, max(r.inicio) desc
      limit 6
    ) x
  ), '[]'::json);
end $$;

notify pgrst, 'reload schema';
