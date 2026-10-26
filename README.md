# Reservas de Tenis · Club San Fernando

Web app para que los socios con carnet de tenis reserven canchas, y para que la
Capitanía de Tenis administre bloqueos. Reemplaza a Simple Solution.

**Stack:** React + Vite + Tailwind (front) · Supabase / Postgres (datos y reglas) · Netlify (publicación).

## Reglas (blindadas en la base de datos)

- 15 canchas, de 08:00 a 22:00, turnos que arrancan cada media hora.
- **Single 60 min · Dobles 90 min.**
- Los turnos del día D se habilitan a las **22:00 de D-2** (ej.: el domingo se habilita el viernes 22:00).
- **Una sola reserva activa por socio**, como titular o como jugador.
- Todos los jugadores tienen que tener **carnet de tenis vigente**.
- Nunca puede haber dos reservas superpuestas en la misma cancha, aunque dos socios reserven en el mismo segundo.
- El titular puede **cancelar en cualquier momento**. La Capitanía también.
- La Capitanía bloquea franjas (puntuales o semanales) y puede cerrar por lluvia.
- Login: número de socio + DNI. 5 intentos fallidos bloquean 15 minutos.

Horarios y ventana de habilitación se cambian en la tabla `config` (Supabase → Table Editor).

## Puesta en marcha

### 1. Base de datos (Supabase)
1. En [supabase.com](https://supabase.com) → proyecto → **SQL Editor** → **New query**.
2. Pegar y correr `supabase/migrations/20261026000000_inicial.sql`.
3. (Opcional, para probar) pegar y correr `supabase/seed_demo.sql`: crea socios ficticios.

Socios de prueba (número / DNI):

| Socio | Nº | DNI | Notas |
|---|---|---|---|
| Socio Prueba | 99001 | 30111222 | |
| Martín Álvarez | 99002 | 30222333 | |
| Lucía Benítez | 99003 | 30333444 | |
| Tomás Herrera | 99006 | 30666777 | sin carnet (no puede entrar) |
| Juan Sosa | 99008 | 30888999 | carnet vencido |
| Capitanía de Tenis | 99900 | 20000000 | ve el panel de Capitanía |

### 2. Correr en la compu
```bash
npm install
cp .env.example .env     # completar URL y clave "anon" de Supabase
npm run dev
```

### 3. Publicar (Netlify)
Conectar el repo en Netlify (como Encontralo) y cargar en
**Site configuration → Environment variables** las dos variables de `.env.example`.

## Cargar los socios reales
Tabla `socios`: `nro`, `dni`, `nombre`, `apellido`, `activo`, `carnet_tenis`,
`carnet_vence` (opcional), `celular`, `email`, `rol` (`socio` o `capitania`).
Se puede importar un CSV desde Supabase → Table Editor → `socios` → Insert → Import data from CSV.
Después, borrar los de prueba: `delete from socios where nro like '99%';`

## Pendiente
- Validación real del carnet (Excel de socios activos → luego conexión con AF Sistemas).
- Horario real de apertura y cierre.
- Recordatorios por WhatsApp (requiere WhatsApp Business API).
- Versión app (después de validar la web).
