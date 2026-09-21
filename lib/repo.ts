import 'server-only'

import { db, DbError } from '@/lib/db'
import { hashPin } from '@/lib/pin'
import type { Adjustment, Employee, Punch } from '@/lib/timeclock'

/**
 * Acceso a datos. Traduce entre las filas de Postgres (snake_case, minutos como
 * enteros) y los tipos de dominio, y convierte los errores de Supabase en
 * mensajes que se le pueden mostrar a una persona.
 */

type EmployeeRow = {
  id: string
  name: string
  department: string
  hourly_wage: number
  active: boolean
}

type PunchRow = {
  id: string
  employee_id: string
  day: string
  in_min: number
  out_min: number | null
  edited: boolean
  note: string | null
}

type AdjustmentRow = {
  id: string
  employee_id: string
  day: string
  kind: 'bonus' | 'deduction'
  amount: number
  note: string | null
}

const EMPLOYEE_COLS = 'id, name, department, hourly_wage, active'
const PUNCH_COLS = 'id, employee_id, day, in_min, out_min, edited, note'
const ADJUSTMENT_COLS = 'id, employee_id, day, kind, amount, note'

function toEmployee(r: EmployeeRow): Employee {
  return {
    id: r.id,
    name: r.name,
    department: r.department,
    hourlyWage: Number(r.hourly_wage),
    active: r.active,
  }
}

function toPunch(r: PunchRow): Punch {
  return {
    id: r.id,
    employeeId: r.employee_id,
    day: r.day,
    in: r.in_min,
    out: r.out_min,
    edited: r.edited,
    note: r.note,
  }
}

function toAdjustment(r: AdjustmentRow): Adjustment {
  return {
    id: r.id,
    employeeId: r.employee_id,
    day: r.day,
    kind: r.kind,
    amount: Number(r.amount),
    note: r.note,
  }
}

/** Código de violación de restricción única en Postgres. */
const UNIQUE_VIOLATION = '23505'

function fail(action: string, error: { message: string; code?: string }): never {
  throw new DbError(`No se pudo ${action}. ${error.message}`, error)
}

/* -------------------------------- empleados ------------------------------- */

export async function listEmployees(): Promise<Employee[]> {
  const { data, error } = await db()
    .from('employees')
    .select(EMPLOYEE_COLS)
    .order('active', { ascending: false })
    .order('name')

  if (error) fail('cargar los empleados', error)
  return (data as EmployeeRow[]).map(toEmployee)
}

export async function findEmployeeByPin(pin: string): Promise<Employee | null> {
  const { data, error } = await db()
    .from('employees')
    .select(EMPLOYEE_COLS)
    .eq('pin_hash', hashPin(pin))
    .maybeSingle()

  if (error) fail('verificar el PIN', error)
  return data ? toEmployee(data as EmployeeRow) : null
}

export type NewEmployee = {
  name: string
  pin: string
  department: string
  hourlyWage: number
}

export type EmployeeResult = { ok: true; employee: Employee } | { ok: false; error: string }

export async function createEmployee(input: NewEmployee): Promise<EmployeeResult> {
  const { data, error } = await db()
    .from('employees')
    .insert({
      name: input.name,
      pin_hash: hashPin(input.pin),
      department: input.department,
      hourly_wage: input.hourlyWage,
      active: true,
    })
    .select(EMPLOYEE_COLS)
    .single()

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return { ok: false, error: 'Ese PIN ya está asignado a otro empleado. Elegí uno distinto.' }
    }
    return { ok: false, error: `No se pudo dar de alta al empleado. ${error.message}` }
  }

  return { ok: true, employee: toEmployee(data as EmployeeRow) }
}

export type EmployeePatch = {
  name?: string
  department?: string
  hourlyWage?: number
  active?: boolean
  pin?: string
}

export async function updateEmployee(id: string, patch: EmployeePatch): Promise<EmployeeResult> {
  const row: Record<string, unknown> = {}
  if (patch.name !== undefined) row.name = patch.name
  if (patch.department !== undefined) row.department = patch.department
  if (patch.hourlyWage !== undefined) row.hourly_wage = patch.hourlyWage
  if (patch.active !== undefined) row.active = patch.active
  if (patch.pin !== undefined) row.pin_hash = hashPin(patch.pin)

  if (Object.keys(row).length === 0) {
    return { ok: false, error: 'No hay cambios para guardar.' }
  }

  const { data, error } = await db()
    .from('employees')
    .update(row)
    .eq('id', id)
    .select(EMPLOYEE_COLS)
    .maybeSingle()

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return { ok: false, error: 'Ese PIN ya está asignado a otro empleado. Elegí uno distinto.' }
    }
    return { ok: false, error: `No se pudieron guardar los cambios. ${error.message}` }
  }
  if (!data) return { ok: false, error: 'Ese empleado ya no existe. Actualizá la página.' }

  return { ok: true, employee: toEmployee(data as EmployeeRow) }
}

export async function deleteEmployee(id: string): Promise<void> {
  // Los fichajes caen con el empleado por el ON DELETE CASCADE del esquema.
  const { error } = await db().from('employees').delete().eq('id', id)
  if (error) fail('eliminar al empleado', error)
}

/* --------------------------------- fichajes -------------------------------- */

/**
 * El fichaje abierto de un empleado, si tiene uno — sin importar el día en
 * que empezó. Un turno que arranca 23:50 y sigue abierto pasada la
 * medianoche no deja de ser "el mismo fichaje sin cerrar" solo porque cambió
 * la fecha calendario; filtrar por el día de hoy hacía que el kiosco no lo
 * encontrara y abriera uno nuevo en vez de cerrar el de anoche.
 */
export async function getOpenPunch(employeeId: string): Promise<Punch | null> {
  const { data, error } = await db()
    .from('punches')
    .select(PUNCH_COLS)
    .eq('employee_id', employeeId)
    .is('out_min', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) fail('leer el fichaje abierto', error)
  return data ? toPunch(data as PunchRow) : null
}

export async function openPunch(employeeId: string, day: string, minute: number): Promise<Punch> {
  const { data, error } = await db()
    .from('punches')
    .insert({ employee_id: employeeId, day, in_min: minute, out_min: null })
    .select(PUNCH_COLS)
    .single()

  if (error) {
    // El índice único `punches_one_open_per_employee_day` (out_min is null)
    // salta cuando dos toques casi simultáneos del mismo PIN ya insertaron un
    // turno abierto ese día entre el getOpenPunch() previo y este insert.
    if (error.code === UNIQUE_VIOLATION) {
      throw new DbError('Ya hay un fichaje abierto para este empleado hoy. Actualizá e intentá de nuevo.', error)
    }
    fail('registrar la entrada', error)
  }
  return toPunch(data as PunchRow)
}

export async function closePunch(punchId: string, minute: number): Promise<Punch> {
  const { data, error } = await db()
    .from('punches')
    .update({ out_min: minute })
    .eq('id', punchId)
    .is('out_min', null) // no pisa una salida ya registrada por otra terminal
    .select(PUNCH_COLS)
    .maybeSingle()

  if (error) fail('registrar la salida', error)
  if (!data) throw new DbError('La salida ya estaba registrada. Actualizá y volvé a intentar.')
  return toPunch(data as PunchRow)
}

export async function listPunchesByEmployee(employeeId: string, fromDay: string): Promise<Punch[]> {
  const { data, error } = await db()
    .from('punches')
    .select(PUNCH_COLS)
    .eq('employee_id', employeeId)
    .gte('day', fromDay)
    .order('day', { ascending: false })

  if (error) fail('cargar tus registros', error)
  return (data as PunchRow[]).map(toPunch)
}

export type PunchFilter = {
  employeeId?: string
  from?: string
  to?: string
  limit?: number
}

export async function listPunches(filter: PunchFilter = {}): Promise<Punch[]> {
  let q = db().from('punches').select(PUNCH_COLS)

  if (filter.employeeId) q = q.eq('employee_id', filter.employeeId)
  if (filter.from) q = q.gte('day', filter.from)
  if (filter.to) q = q.lte('day', filter.to)

  const { data, error } = await q
    .order('day', { ascending: false })
    .order('in_min', { ascending: false })
    .limit(filter.limit ?? 500)

  if (error) fail('cargar el historial', error)
  return (data as PunchRow[]).map(toPunch)
}

export type ManualPunch = {
  /** Si viene, corrige ese fichaje puntual; si no, carga uno nuevo. */
  id?: string
  employeeId: string
  day: string
  in: number
  out: number | null
  note: string | null
}

/**
 * Alta o corrección manual desde el panel. Con horario cortado un empleado
 * puede tener varios fichajes el mismo día, así que ya no hay una fila
 * "la del día" para hacer upsert: si `input.id` viene definido se corrige
 * ese fichaje puntual; si no, se carga uno nuevo (aunque ese empleado ya
 * tenga otro fichaje ese mismo día).
 */
export async function saveManualPunch(input: ManualPunch): Promise<Punch> {
  if (input.id) {
    const { data, error } = await db()
      .from('punches')
      .update({ in_min: input.in, out_min: input.out, note: input.note, edited: true })
      .eq('id', input.id)
      .select(PUNCH_COLS)
      .maybeSingle()

    if (error) {
      if (error.code === UNIQUE_VIOLATION) {
        throw new DbError('Este empleado ya tiene otro fichaje abierto ese día. Cerralo antes de dejar este sin salida.', error)
      }
      fail('corregir el fichaje', error)
    }
    if (!data) throw new DbError('Ese fichaje ya no existe. Actualizá y volvé a intentar.')
    return toPunch(data as PunchRow)
  }

  const { data, error } = await db()
    .from('punches')
    .insert({
      employee_id: input.employeeId,
      day: input.day,
      in_min: input.in,
      out_min: input.out,
      note: input.note,
      edited: true,
    })
    .select(PUNCH_COLS)
    .single()

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      throw new DbError('Este empleado ya tiene otro fichaje abierto ese día. Cerralo antes de cargar uno nuevo sin salida.', error)
    }
    fail('guardar el fichaje', error)
  }
  return toPunch(data as PunchRow)
}

export async function deletePunch(id: string): Promise<void> {
  const { error } = await db().from('punches').delete().eq('id', id)
  if (error) fail('eliminar el fichaje', error)
}

/**
 * Borra los fichajes de un rango de días (inclusive). Usado en el cierre de
 * mes. Nunca borra un fichaje sin salida: si alguien sigue trabajando ese
 * turno cuando se cierra el mes, perder su hora de entrada sería un dato
 * imposible de reconstruir.
 */
export async function deletePunchesInRange(from: string, to: string): Promise<void> {
  const { error } = await db()
    .from('punches')
    .delete()
    .gte('day', from)
    .lte('day', to)
    .not('out_min', 'is', null)
  if (error) fail('borrar los fichajes del mes', error)
}

/**
 * Fichajes sin salida de días anteriores a `beforeDay`, sin ventana de
 * tiempo: uno olvidado hace dos meses tiene que seguir apareciendo en el
 * aviso del panel hasta que un admin lo corrija, no desaparecer solo.
 */
export async function listDanglingPunches(beforeDay: string, limit = 200): Promise<Punch[]> {
  const { data, error } = await db()
    .from('punches')
    .select(PUNCH_COLS)
    .lt('day', beforeDay)
    .is('out_min', null)
    .order('day', { ascending: true })
    .limit(limit)

  if (error) fail('cargar las jornadas sin cerrar', error)
  return (data as PunchRow[]).map(toPunch)
}

/* -------------------------------- ajustes ---------------------------------- */

export type AdjustmentFilter = {
  employeeId?: string
  from?: string
  to?: string
}

export async function listAdjustments(filter: AdjustmentFilter = {}): Promise<Adjustment[]> {
  let q = db().from('adjustments').select(ADJUSTMENT_COLS)

  if (filter.employeeId) q = q.eq('employee_id', filter.employeeId)
  if (filter.from) q = q.gte('day', filter.from)
  if (filter.to) q = q.lte('day', filter.to)

  const { data, error } = await q.order('day', { ascending: false }).limit(500)

  if (error) fail('cargar las compensaciones', error)
  return (data as AdjustmentRow[]).map(toAdjustment)
}

export type NewAdjustment = {
  employeeId: string
  day: string
  kind: 'bonus' | 'deduction'
  amount: number
  note: string | null
}

export async function createAdjustment(input: NewAdjustment): Promise<Adjustment> {
  const { data, error } = await db()
    .from('adjustments')
    .insert({
      employee_id: input.employeeId,
      day: input.day,
      kind: input.kind,
      amount: input.amount,
      note: input.note,
    })
    .select(ADJUSTMENT_COLS)
    .single()

  if (error) fail('registrar la compensación', error)
  return toAdjustment(data as AdjustmentRow)
}

export async function deleteAdjustment(id: string): Promise<void> {
  const { error } = await db().from('adjustments').delete().eq('id', id)
  if (error) fail('eliminar la compensación', error)
}

/** Borra las compensaciones de un rango de días (inclusive). Usado en el cierre de mes. */
export async function deleteAdjustmentsInRange(from: string, to: string): Promise<void> {
  const { error } = await db().from('adjustments').delete().gte('day', from).lte('day', to)
  if (error) fail('borrar las compensaciones del mes', error)
}

/* ------------------------------ administradores ---------------------------- */

export type AdminRecord = { id: string; username: string; mustChangePassword: boolean }

export async function verifyAdmin(username: string, password: string): Promise<AdminRecord | null> {
  const { data, error } = await db().rpc('verify_admin', {
    p_username: username,
    p_password: password,
  })

  if (error) fail('verificar las credenciales', error)

  const row = (data as { id: string; username: string; must_change_password: boolean }[] | null)?.[0]
  if (!row) return null
  return { id: row.id, username: row.username, mustChangePassword: row.must_change_password }
}

export async function changeAdminPassword(
  adminId: string,
  current: string,
  next: string,
): Promise<boolean> {
  const { data, error } = await db().rpc('change_admin_password', {
    p_admin_id: adminId,
    p_current: current,
    p_new: next,
  })

  if (error) fail('cambiar la contraseña', error)
  return data === true
}
