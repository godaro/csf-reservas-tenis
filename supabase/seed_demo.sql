-- =====================================================================
-- Datos de PRUEBA (socios ficticios). Correr después del esquema inicial.
-- Cuando lleguen los socios reales del Excel, borrar estos con:
--   delete from public.socios where nro like '99%';
-- =====================================================================

insert into public.socios (nro, dni, nombre, apellido, carnet_tenis, carnet_vence, rol) values
  ('99000', '30000000', 'Socio',     'Prueba',     true,  null, 'socio'),
  ('99001', '30111222', 'Darío',     'Aguilar',    true,  null, 'socio'),
  ('99002', '30222333', 'Martín',    'Álvarez',    true,  null, 'socio'),
  ('99003', '30333444', 'Lucía',     'Benítez',    true,  null, 'socio'),
  ('99004', '30444555', 'Pablo',     'Ferreyra',   true,  null, 'socio'),
  ('99005', '30555666', 'Sofía',     'Galli',      true,  null, 'socio'),
  ('99006', '30666777', 'Tomás',     'Herrera',    false, null, 'socio'),   -- sin carnet
  ('99007', '30777888', 'Valentina', 'Ríos',       true,  null, 'socio'),
  ('99008', '30888999', 'Juan',      'Sosa',       true,  '2026-01-31', 'socio'), -- carnet vencido
  ('99900', '20000000', 'Capitanía', 'de Tenis',   true,  null, 'capitania')
on conflict (nro) do nothing;

-- Bloqueo semanal de ejemplo: Escuela de Tenis, sábados 9 a 12, canchas 1 a 4
insert into public.bloqueos (cancha_id, motivo, dia_semana, hora_desde, hora_hasta, creado_por)
select n, 'Escuela de Tenis', 6, '09:00', '12:00', '99900' from generate_series(1, 4) n;
