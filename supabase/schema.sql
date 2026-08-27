-- ============================================================================
--  Fichaje MAGA · esquema de base de datos (Supabase / PostgreSQL)
-- ============================================================================
--  Ejecutar una sola vez en el SQL Editor de Supabase.
--  Es idempotente: se puede volver a correr sin romper nada.
--
--  Modelo de datos: un par entrada/salida por empleado y por día.
--  Los minutos se guardan como enteros desde la medianoche del día `day`,
--  en hora de Argentina. Una salida a las 02:00 del día siguiente se guarda
--  como 1560 (26 h), lo que permite turnos que cruzan la medianoche sin
--  romper el modelo de un registro por día.
-- ============================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------- empleados --

create table if not exists public.employees (
  id          uuid primary key default gen_random_uuid(),
  name        text        not null check (length(btrim(name)) >= 3),
  pin_hash    text        not null unique,
  department  text        not null default 'General',
  hourly_wage numeric(10,2) not null default 0 check (hourly_wage >= 0),
  active      boolean     not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- `create table if not exists` no toca una tabla que ya existe: en una base
-- creada con un esquema anterior, hay que agregar (o sacar) columnas a mano
-- para que este archivo se pueda volver a correr sin romper nada.
alter table public.employees add column if not exists hourly_wage numeric(10,2) not null default 0 check (hourly_wage >= 0);
alter table public.employees drop column if exists role;

comment on column public.employees.pin_hash is
  'HMAC-SHA256 del PIN con PIN_PEPPER. El PIN en claro nunca se guarda ni se puede recuperar.';

comment on column public.employees.hourly_wage is
  'Salario por hora, para estimar el costo laboral en Historial y en el cierre de mes.';

create index if not exists employees_active_idx on public.employees (active, name);

-- ---------------------------------------------------------------- fichajes ---

create table if not exists public.punches (
  id           uuid primary key default gen_random_uuid(),
  employee_id  uuid        not null references public.employees (id) on delete cascade,
  day          date        not null,
  in_min       integer     not null check (in_min >= 0 and in_min <= 1439),
  out_min      integer     check (out_min is null or (out_min > in_min and out_min <= 2879)),
  note         text,
  edited       boolean     not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Antes había un unique (employee_id, day): un solo par entrada/salida por
-- día. El personal con horario cortado ficha más de una vez por día, así que
-- se saca. `day` se queda: se sigue usando para filtrar y agrupar.
alter table public.punches drop constraint if exists punches_employee_id_day_key;

comment on column public.punches.edited is
  'true si un administrador creó o corrigió el registro a mano desde el panel.';

create index if not exists punches_day_idx      on public.punches (day desc, in_min desc);
create index if not exists punches_employee_idx on public.punches (employee_id, day desc);

-- -------------------------------------------------------------- ajustes ------
-- Compensaciones manuales por empleado: bonos (vendió más) o descuentos
-- (rompió algo, faltó sin aviso). Se suman/restan del salario estimado en
-- Historial y se incluyen en el cierre de mes.

create table if not exists public.adjustments (
  id           uuid primary key default gen_random_uuid(),
  employee_id  uuid        not null references public.employees (id) on delete cascade,
  day          date        not null,
  kind         text        not null check (kind in ('bonus', 'deduction')),
  amount       numeric(10,2) not null check (amount > 0),
  note         text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists adjustments_day_idx      on public.adjustments (day desc);
create index if not exists adjustments_employee_idx on public.adjustments (employee_id, day desc);

-- ------------------------------------------------------------ administradores --

create table if not exists public.admins (
  id                   uuid primary key default gen_random_uuid(),
  username             text        not null unique,
  password_hash        text        not null,
  must_change_password boolean     not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- Administrador inicial: admin / cambiar123
-- El panel obliga a cambiar la contraseña en el primer ingreso.
insert into public.admins (username, password_hash, must_change_password)
values ('admin', extensions.crypt('cambiar123', extensions.gen_salt('bf', 10)), true)
on conflict (username) do nothing;

-- --------------------------------------------------------- updated_at touch --

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists employees_touch on public.employees;
create trigger employees_touch before update on public.employees
  for each row execute function public.touch_updated_at();

drop trigger if exists punches_touch on public.punches;
create trigger punches_touch before update on public.punches
  for each row execute function public.touch_updated_at();

drop trigger if exists adjustments_touch on public.adjustments;
create trigger adjustments_touch before update on public.adjustments
  for each row execute function public.touch_updated_at();

drop trigger if exists admins_touch on public.admins;
create trigger admins_touch before update on public.admins
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------------ verificación de admin --
-- La contraseña se verifica dentro de Postgres con bcrypt; el hash nunca sale
-- de la base. security definer + search_path fijo para que no dependa del
-- search_path del que la llama.

create or replace function public.verify_admin(p_username text, p_password text)
returns table (id uuid, username text, must_change_password boolean)
language sql
security definer
set search_path = public, extensions
as $$
  select a.id, a.username, a.must_change_password
  from public.admins a
  where a.username = lower(btrim(p_username))
    and a.password_hash = extensions.crypt(p_password, a.password_hash);
$$;

create or replace function public.change_admin_password(
  p_admin_id uuid,
  p_current  text,
  p_new      text
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_ok boolean;
begin
  select (password_hash = extensions.crypt(p_current, password_hash))
    into v_ok
  from public.admins
  where id = p_admin_id;

  if v_ok is not true then
    return false;
  end if;

  update public.admins
     set password_hash        = extensions.crypt(p_new, extensions.gen_salt('bf', 10)),
         must_change_password = false
   where id = p_admin_id;

  return true;
end;
$$;

-- ------------------------------------------------------------------- RLS -----
-- Todas las tablas quedan cerradas y sin políticas: ni la clave anónima ni un
-- usuario autenticado pueden leer o escribir nada. Toda la aplicación pasa por
-- server actions de Next.js que usan la service role key, que sí saltea RLS.

alter table public.employees   enable row level security;
alter table public.punches     enable row level security;
alter table public.adjustments enable row level security;
alter table public.admins      enable row level security;

-- Supabase ya le da acceso a service_role a las tablas nuevas del esquema
-- public por default privileges. Lo explicitamos igual: cuesta nada y deja el
-- esquema completo si alguna vez se restaura en otra base.
grant all on public.employees   to service_role;
grant all on public.punches     to service_role;
grant all on public.adjustments to service_role;
grant all on public.admins      to service_role;

-- Las funciones son ejecutables solo por service_role: sin este revoke,
-- cualquiera con la clave anónima podría probar contraseñas contra verify_admin.
revoke all on function public.verify_admin(text, text)               from public, anon, authenticated;
revoke all on function public.change_admin_password(uuid, text, text) from public, anon, authenticated;
grant execute on function public.verify_admin(text, text)               to service_role;
grant execute on function public.change_admin_password(uuid, text, text) to service_role;
