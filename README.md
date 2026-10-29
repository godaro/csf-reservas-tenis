# Reservas de Tenis · Club San Fernando

Web app para que los socios con carnet de tenis reserven canchas, y para que la
Capitanía de Tenis administre bloqueos. Reemplaza a Simple Solution.

**Stack:** React + Vite + Tailwind (front) · Supabase / Postgres (datos y reglas) · Netlify (publicación).

## Reglas (blindadas en la base de datos)

- 15 canchas, de 08:00 a 22:00, turnos que arrancan cada media hora.
- **Single 60 min · Dobles 90 min.**
- Los turnos del día D se habilitan a las **22:00 de D-2** (ej.: el domingo se habilita el viernes 22:00).
- **Hasta 2 reservas activas por socio**, como titular o como jugador, con **al menos 3 horas libres** entre una y otra (`config.separacion_min` = 180).
- Todos los jugadores tienen que tener **carnet de tenis vigente**.
- **Invitado no socio:** uno por partido, cargado por el socio al reservar (nombre, apellido y DNI). Solo miércoles y viernes
  de 8 a 22 y domingos desde las 12 (`config.invitados_franjas`). Paga el día en la Capitanía, que lo marca como pagado en el panel.
- Nunca puede haber dos reservas superpuestas en la misma cancha, aunque dos socios reserven en el mismo segundo.
- El titular puede **cancelar en cualquier momento**. La Capitanía también.
- Desde el panel, la Capitanía toca una reserva y puede **cambiarla de cancha** (mismo horario) o **reemplazar a un jugador**
  (el que entra cumple las mismas reglas: carnet, máximo de reservas y separación). Avisa por mail a todos los afectados.
- La Capitanía tiene su propio panel en `/capitania` (solo cuentas con rol `capitania`): ve la grilla del día, bloquea franjas (puntuales o semanales) y puede cancelar reservas. Si un bloqueo pisa reservas, el panel las lista y pide confirmar: al confirmar se cancelan y los socios lo ven en "Mis reservas" con el motivo.
- Login de socios: número de socio + DNI. Capitanía: usuario + clave. 5 intentos fallidos bloquean 15 minutos.

Horarios, ventana de habilitación, máximo de reservas (`max_reservas`) y separación mínima en minutos (`separacion_min`) se cambian en la tabla `config` (Supabase → Table Editor).

## Puesta en marcha

### 1. Base de datos (Supabase)
1. En [supabase.com](https://supabase.com) → proyecto → **SQL Editor** → **New query**.
2. Pegar y correr `supabase/migrations/20261026000000_inicial.sql`.
3. Pegar y correr `supabase/migrations/20261026010000_companeros_frecuentes.sql` (compañeros frecuentes).
4. Pegar y correr `supabase/migrations/20261026020000_bloqueos_sobre_reservas.sql` (bloqueos que pisan reservas).
5. Pegar y correr `supabase/migrations/20261027000000_avisos_mail.sql` (avisos por mail).
6. Pegar y correr `supabase/migrations/20261027010000_aviso_quien_cancela.sql` (aviso también a quien cancela).
7. Pegar y correr `supabase/migrations/20261027020000_capitania_usuario_clave.sql` (Capitanía con usuario y clave).
8. Pegar y correr `supabase/migrations/20261027030000_avisos_solo_mail_valido.sql` (avisos solo a mails válidos).
9. Pegar y correr `supabase/migrations/20261027040000_mail_del_socio.sql` (el socio carga su mail).
10. Pegar y correr `supabase/migrations/20261027050000_dos_reservas.sql` (hasta 2 reservas, separadas 1 hora).
11. Pegar y correr `supabase/migrations/20261027060000_buscador_sin_yo.sql` (el buscador no muestra al propio socio).
12. Pegar y correr `supabase/migrations/20261028000000_admin_socios.sql` (Administración: Excel semanal y altas manuales).
13. Crear el usuario de la Capitanía: `select crear_usuario_capitania('capitania', 'Capitanía de Tenis', 'una-clave-temporal');`
14. Pegar y correr `supabase/migrations/20261028010000_admin_mails_corregidos.sql` (lista de mails corregidos por los socios).
15. Pegar y correr `supabase/migrations/20261028020000_admin_reactivar.sql` (botón "Volver a dar de alta").
16. Volver a desplegar la Edge Function `enviar-avisos` con el `index.ts` nuevo y **después** pegar y correr
    `supabase/migrations/20261028030000_capitania_editar_reserva.sql` (la Capitanía modifica reservas).
17. Pegar y correr `supabase/migrations/20261029000000_invitados.sql` (invitados no socios).
18. Crear el usuario de Administración: `select crear_usuario_admin('admin', 'Administración', 'una-clave-temporal');`
19. (Opcional, para probar) pegar y correr `supabase/seed_demo.sql`: crea socios ficticios.

Socios de prueba (número / DNI):

| Socio | Nº | DNI | Notas |
|---|---|---|---|
| Socio Prueba | 99000 | 30000000 | |
| Socio Prueba 2 | 99001 | 30111222 | |
| Juan Pérez | 99002 | 30222333 | |
| Lucía Benítez | 99003 | 30333444 | |
| Tomás Herrera | 99006 | 30666777 | sin carnet (no puede entrar) |
| Juan Sosa | 99008 | 30888999 | carnet vencido |

La Capitanía entra por `/capitania` con **usuario y clave** (ver paso 8). Puede haber un usuario por persona;
cada uno cambia su clave desde el panel (Mi cuenta → Cambiar clave). Para resetear una clave olvidada,
volver a correr `crear_usuario_capitania` con el mismo usuario. Las cuentas de Capitanía no aparecen como
compañeros ni pueden jugar.

### 2. Correr en la compu
```bash
npm install
cp .env.example .env     # completar URL y clave "anon" de Supabase
npm run dev
```

### 3. Publicar (Netlify)
Conectar el repo en Netlify (como Encontralo) y cargar en
**Site configuration → Environment variables** las dos variables de `.env.example`.

## Analytics (Google Analytics 4)

Opcional: con la variable `VITE_GA_ID` (ID de medición `G-…`) en Netlify se activa GA4. Cada pantalla cuenta como una
página virtual (`/ingreso`, `/reservar`, `/reservar/cancha`, `/reservar/jugadores`, `/reservar/confirmada`,
`/mis-reservas`, `/capitania`, `/admin`) y se registran los eventos `login`, `reserva_confirmada`, `reserva_cancelada` y
`compartir_whatsapp`. Nunca se envían datos personales (número de socio, nombres, DNI ni mails).

## Avisos por mail

Cuando se confirma o se cancela una reserva, cada jugador con mail recibe un aviso
desde `web@clubsanfernando.org.ar` (servidor `mail.clubsanfernando.org.ar`, puerto 465 SSL).
La confirmación trae un botón para Google Calendar y un `.ics` adjunto con recordatorio 2 horas antes.

- La base anota los avisos en la tabla `avisos` y despierta a la Edge Function `enviar-avisos`.
- La cancelación les llega a todos los jugadores, incluido quien canceló (con un texto propio).
- Si un envío falla, se reintenta cada 5 minutos (hasta 5 veces). La reserva nunca se ve afectada.
- Socios sin mail o con mail incompleto (ej. cortado en la exportación de AF): el aviso queda como `sin_mail`.
- Si el socio no tiene mail válido, la app le pide que lo cargue; también lo puede cambiar desde "Mis reservas".
  Listado para Administración (para actualizar AF Sistemas):
  `select nro, apellido, nombre, email_anterior as mail_en_af, email as mail_nuevo, email_socio_en from socios where email_socio_en is not null order by email_socio_en desc;`

Instalación de la función (Supabase → **Edge Functions**):
1. **Deploy a new function → Via Editor**, nombre `enviar-avisos`, pegar `supabase/functions/enviar-avisos/index.ts` → **Deploy**.
2. En la función, desactivar **Verify JWT** (la protege la clave `AVISOS_CLAVE`).
3. **Edge Functions → Secrets**: `SMTP_PASS` (contraseña de web@) y `AVISOS_CLAVE`
   (sale de `select valor from config_privada where clave = 'avisos_clave';`).

Ver cómo van: `select id, tipo, socio_nro, estado, intentos, error, creado from avisos order by id desc limit 50;`

## Administración (`/admin`)

El usuario `admin` entra en `/admin` con usuario y clave y ve solo la sección Socios:

- **Padrón semanal:** se sube el PDF "Listado de Socios por Conceptos" de AF Sistemas (o un Excel con columnas
  Socio, Nombre, Teléfono, Email, Dni). Del PDF se toman Socio, Nombre, Teléfono, E-Mail y Nrodoc; quedan afuera los
  que tienen "Hasta" vencido o "Cantidad" 0 (se listan en la vista previa). Se lee y limpia
  en el navegador (nombres, mails cortados `@gm…`, `@yahoo.com.`, `@fibertel`…), se muestra qué cambia y se aplica.
  El Excel trae a **todos** los activos: quien no está pierde el carnet (sus reservas ya hechas se mantienen).
- **Alta manual:** para quien paga el carnet en la semana; reserva en el momento. Si llega en el Excel siguiente queda
  como uno más; si no llega, esa carga lo da de baja (se puede tildar para mantenerlo).
- **Buscar socio / dar de baja** el carnet, o **volver a dar de alta** a uno sin carnet con los datos de su ficha
  (queda como alta manual hasta que llegue en el Excel).
- **Mails corregidos por los socios:** lista (descargable en Excel) para actualizar AF Sistemas. Cuando el Excel
  semanal ya trae el mail nuevo, el socio sale de la lista solo.
- Los socios de prueba (`prueba = true`) no se tocan con las cargas. Historial: `select * from padron_cargas order by id desc;`

## Cargar los socios reales
Tabla `socios`: `nro`, `dni`, `nombre`, `apellido`, `activo`, `carnet_tenis`,
`carnet_vence` (opcional), `celular`, `email`, `rol` (`socio` o `capitania`).
Se puede importar un CSV desde Supabase → Table Editor → `socios` → Insert → Import data from CSV.
Después, borrar los de prueba: `delete from socios where nro like '99%';`

## Pendiente
- Validación real del carnet (Excel de socios activos → luego conexión con AF Sistemas).
- Horario real de apertura y cierre.
- Favoritos fijados a mano (estrellita), si los socios lo piden.
- Confirmar con LabsIT el límite de envíos por hora de web@.
- Recordatorios por WhatsApp (requiere WhatsApp Business API).
- Versión app (después de validar la web).
