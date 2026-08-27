# Fichaje MAGA

Terminal de fichaje con PIN y panel de administración, para registrar entradas
y salidas del personal.

- **`/`** — la terminal. El empleado ingresa su PIN de 4 dígitos y queda
  registrada su entrada o su salida. También puede consultar sus horas de la
  jornada, la semana y el mes.
- **`/admin`** — el panel. Alta, baja y edición de empleados, corrección manual
  de fichajes olvidados, historial filtrable y exportación a CSV.

Next.js 16 · React 19 · Tailwind 4 · Supabase (PostgreSQL) · desplegado en Netlify.

---

## Cómo está armado

Los datos **nunca** se leen desde el navegador. Toda lectura y escritura pasa
por server actions (`app/actions/`) que corren en el servidor con la
`service_role` de Supabase. Las tablas tienen RLS activo y **ninguna política**,
así que ni la clave anónima ni un usuario autenticado pueden leer nada
directamente: la única puerta es el servidor, donde se valida quién pide qué.

Consecuencias prácticas:

- El navegador nunca recibe la lista de empleados ni sus PIN.
- Los PIN se guardan como HMAC-SHA256 con una clave del servidor (`PIN_PEPPER`).
  No se pueden recuperar: si alguien olvida el suyo, se le asigna uno nuevo.
- La contraseña de administrador se verifica con bcrypt **dentro de Postgres**
  (`verify_admin`); el hash nunca sale de la base.
- La sesión del panel es una cookie httpOnly firmada con HMAC (`SESSION_SECRET`).

### El modelo de fichaje

Un par entrada/salida por empleado y por día (`unique (employee_id, day)`).
Los horarios se guardan como minutos desde la medianoche del día del registro.

Un turno que termina al día siguiente se guarda pasado de 1440: la salida a la
01:30 es `1530` (25:30), y en pantalla aparece como `01:30 +1`. Así un turno
nocturno entra en el modelo de un registro por día sin partirlo en dos.

Si alguien se olvida de fichar, el administrador carga o corrige el registro
desde el panel; queda marcado como `corregido` en el historial y en el CSV.

### Huso horario

Todo el sistema razona en `America/Argentina/Buenos_Aires`, definido en
`lib/tz.ts`. Es la pieza más delicada del proyecto: el servidor de Netlify corre
en UTC, así que un fichaje de las 22:30 de un martes caería en el miércoles si
se usara `new Date().getHours()` sin más. Nunca uses los getters de fecha
locales para decidir qué día es: usá `zonedNow()`.

---

## Puesta en marcha

### 1. Base de datos

En [supabase.com](https://supabase.com), creá un proyecto. Después, en
**SQL Editor**, pegá y ejecutá el contenido de `supabase/schema.sql`.

Es idempotente: se puede volver a correr sin romper nada.

Deja creado un administrador inicial **`admin` / `cambiar123`**. El panel avisa
en rojo hasta que la cambies desde la pestaña *Mi cuenta*.

### 2. Variables de entorno

Copiá `.env.example` a `.env.local` y completá los cuatro valores:

| Variable | De dónde sale |
|---|---|
| `SUPABASE_URL` | Project Settings › Data API › Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Project Settings › API Keys › `service_role` |
| `PIN_PEPPER` | `openssl rand -hex 32` |
| `SESSION_SECRET` | `openssl rand -hex 32` |

En PowerShell, para generar los secretos:

```powershell
-join ((1..64) | ForEach-Object { '{0:x}' -f (Get-Random -Max 16) })
```

> `PIN_PEPPER` no se puede rotar sin invalidar todos los PIN. Si alguna vez hay
> que cambiarla, hay que reasignar los PIN desde el panel.

### 3. Correr en local

```bash
pnpm install
pnpm dev
```

### 4. Desplegar en Netlify

1. Subí el repositorio a GitHub.
2. En Netlify: **Add new site › Import an existing project**, elegí el repo.
   El `netlify.toml` ya define el build; no hace falta tocar nada.
3. En **Site settings › Environment variables**, cargá las mismas cuatro
   variables de `.env.local`.
4. Deploy.

---

## Comandos

| | |
|---|---|
| `pnpm dev` | servidor de desarrollo |
| `pnpm build` | build de producción (typechequea) |
| `pnpm test` | verifica el cálculo de horas y el manejo de huso horario |
| `pnpm typecheck` | solo los tipos |

`pnpm test` cubre lo que más fácil se rompe sin que nadie se dé cuenta: que un
fichaje de las 22:30 no se vaya al día siguiente, que la semana arranque el
lunes, que un turno nocturno sume las horas correctas y que una jornada abierta
de hace tres días no cuente como cien horas trabajadas.

---

## Mapa del código

```
app/
  page.tsx              terminal de fichaje
  admin/page.tsx        resuelve la sesión en el servidor: login o panel
  actions/kiosco.ts     fichar y consultar horas
  actions/admin.ts      todo lo del panel (cada acción exige sesión válida)
lib/
  tz.ts                 huso horario de Argentina — leer antes de tocar fechas
  timeclock.ts          tipos, formato y cálculo de horas (puro, sin I/O)
  repo.ts               acceso a datos: filas de Postgres ↔ tipos de dominio
  db.ts                 cliente de Supabase con service role (solo servidor)
  pin.ts                hash de los PIN
  session.ts            cookie de sesión firmada
  rate-limit.ts         freno contra fuerza bruta
components/
  admin/dashboard.tsx   el panel
  admin/ui.tsx          piezas visuales compartidas
supabase/schema.sql     el esquema completo
```

## Deuda conocida

- **El rate limit vive en memoria del proceso.** En Netlify cada instancia
  lleva su propia cuenta y el contador se pierde cuando la función se recicla.
  Frena el goteo de intentos automatizados, no a un atacante decidido. Si esto
  pasa a ser crítico, hay que moverlo a una tabla de Supabase.
- **Un solo administrador.** La tabla `admins` soporta varios, pero el panel no
  tiene una pantalla para gestionarlos: se agregan por SQL.
- **Un par entrada/salida por día.** Si aparece la necesidad de fichar las
  pausas, hay que migrar `punches` a una fila por evento.
