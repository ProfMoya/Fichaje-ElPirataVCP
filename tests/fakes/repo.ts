/**
 * Repositorio en memoria que reemplaza a `lib/repo.ts` en los tests.
 *
 * Reproduce las reglas de la base que le importan al flujo del kiosco, en
 * particular el índice único de `supabase/schema.sql`: un solo fichaje sin
 * salida por empleado *y por día*. Si alguien lo endurece en el esquema, hay
 * que endurecerlo acá también (y `tests/logica.test.ts` vigila el esquema).
 */
import { DbError } from '@/lib/db'
import type { Employee, Punch } from '@/lib/timeclock'

type Entry = Punch & { seq: number }

let employees: (Employee & { pin: string })[] = []
let punches: Entry[] = []
let seq = 0

export const control = { fallarLecturaDeOlvidados: false }

export function reset(): void {
  employees = []
  punches = []
  seq = 0
  control.fallarLecturaDeOlvidados = false
}

export function addEmployee(e: Partial<Employee> & { id: string; name: string; pin: string }): void {
  employees.push({ department: 'General', hourlyWage: 0, active: true, ...e })
}

export function addPunch(p: Pick<Punch, 'employeeId' | 'day' | 'in' | 'out'> & Partial<Punch>): Punch {
  seq += 1
  const entry: Entry = { id: `p${seq}`, edited: false, note: null, seq, ...p }
  punches.push(entry)
  return entry
}

export function allPunches(): Punch[] {
  return punches.map(({ seq: _seq, ...p }) => p)
}

const tick = () => Promise.resolve()

export async function findEmployeeByPin(pin: string): Promise<Employee | null> {
  await tick()
  const found = employees.find((e) => e.pin === pin)
  if (!found) return null
  const { pin: _pin, ...employee } = found
  return employee
}

export async function getOpenPunch(employeeId: string): Promise<Punch | null> {
  await tick()
  const abiertos = punches.filter((p) => p.employeeId === employeeId && p.out === null)
  return abiertos.sort((a, b) => b.seq - a.seq)[0] ?? null
}

export async function openPunch(employeeId: string, day: string, minute: number): Promise<Punch> {
  await tick()
  if (punches.some((p) => p.employeeId === employeeId && p.day === day && p.out === null)) {
    throw new DbError('Ya hay un fichaje abierto para este empleado hoy. Actualizá e intentá de nuevo.')
  }
  return addPunch({ employeeId, day, in: minute, out: null })
}

export async function closePunch(punchId: string, minute: number): Promise<Punch> {
  await tick()
  const p = punches.find((x) => x.id === punchId && x.out === null)
  if (!p) throw new DbError('La salida ya estaba registrada. Actualizá y volvé a intentar.')
  p.out = minute
  return p
}

export async function listPunchesByEmployee(employeeId: string, fromDay: string): Promise<Punch[]> {
  await tick()
  return punches.filter((p) => p.employeeId === employeeId && p.day >= fromDay)
}

export async function listDanglingByEmployee(employeeId: string, beforeDay: string): Promise<Punch[]> {
  await tick()
  if (control.fallarLecturaDeOlvidados) throw new Error('la base no responde')
  return punches
    .filter((p) => p.employeeId === employeeId && p.day < beforeDay && p.out === null)
    .sort((a, b) => (a.day < b.day ? -1 : 1))
}
