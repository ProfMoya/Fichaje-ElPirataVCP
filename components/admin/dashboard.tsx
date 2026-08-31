'use client'

import { useCallback, useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft,
  Archive,
  Award,
  CalendarPlus,
  CalendarRange,
  Clock3,
  Download,
  FileText,
  LogIn,
  LogOut,
  Minus,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  Trash2,
  UserPlus,
  Users,
  Wallet,
} from 'lucide-react'
import {
  cambiarPassword,
  cargarPanel,
  cerrarMes,
  cerrarSesion,
  crearAjuste,
  crearEmpleado,
  editarEmpleado,
  eliminarAjuste,
  eliminarEmpleado,
  eliminarFichaje,
  guardarFichaje,
  type CierreMes,
  type PanelData,
  type PanelFilter,
} from '@/app/actions/admin'
import { Aviso, Boton, Field, Modal, Panel, Select, Stat, StatusPill, Table } from '@/components/admin/ui'
import {
  buildPayrollSummary,
  crossesMidnight,
  estimatedPay,
  formatCurrency,
  formatDecimalHours,
  formatDuration,
  formatLongDate,
  formatShortDate,
  formatTimeLabel,
  formatWeekday,
  parseTimeInput,
  toTimeInput,
  workedMinutes,
  type Adjustment,
  type Employee,
  type PayrollRow,
  type Punch,
} from '@/lib/timeclock'
import { cn } from '@/lib/utils'
import { startOfMonthKey, startOfWeekKey } from '@/lib/tz'

// jspdf + jspdf-autotable + xlsx pesan ~775 KB sin comprimir entre las tres.
// Se usan solo en exportar PDF y en cerrar el mes — importarlas acá arriba
// las metería en el bundle inicial de /admin aunque el admin nunca haga clic
// en esos botones. Se cargan bajo demanda, dentro de las funciones que las
// necesitan.

type Tab = 'resumen' | 'empleados' | 'historial' | 'compensaciones' | 'cuenta'

const TABS: { id: Tab; label: string }[] = [
  { id: 'resumen', label: 'Resumen' },
  { id: 'empleados', label: 'Empleados' },
  { id: 'historial', label: 'Historial' },
  { id: 'compensaciones', label: 'Compensaciones' },
  { id: 'cuenta', label: 'Mi cuenta' },
]

const TIPO_AJUSTE: Record<Adjustment['kind'], string> = {
  bonus: 'Bono / venta extra',
  deduction: 'Descuento',
}

/** Tope de la columna numeric(10,2) en la base: pasado esto, la tarjeta de
 * costo estimado desborda su ancho y el guardado en Supabase falla. */
const MONTO_MAXIMO = 99_999_999

/** Corta un monto tipeado en el input al tope de la columna antes de que llegue al servidor. */
function limitarMonto(value: string): string {
  const n = Number(value)
  return value !== '' && Number.isFinite(n) && n > MONTO_MAXIMO ? String(MONTO_MAXIMO) : value
}

function nombreArchivoCierre(month: string): string {
  return `cierre-${month}.xlsx`
}

/**
 * Arma el libro de cierre de mes con tres hojas (Fichajes, Compensaciones,
 * Resumen por empleado) y lo descarga. Se abre nativo en Excel y en Google
 * Sheets (Archivo › Importar, o arrastrándolo directo a Drive).
 */
async function descargarCierreMes(cierre: CierreMes) {
  const XLSX = await import('xlsx')

  const nombrePorId = new Map(cierre.employees.map((e) => [e.id, e.name]))
  const nombre = (id: string) => nombrePorId.get(id) ?? 'Empleado eliminado'

  const fichajesRows = [
    ['Empleado', 'Fecha', 'Entrada', 'Salida', 'Trabajado', 'Horas decimales', 'Corregido', 'Nota'],
    ...cierre.punches.map((p) => {
      const minutos = workedMinutes(p, cierre.nowMin, p.day === cierre.dayKey)
      return [
        nombre(p.employeeId),
        p.day,
        formatTimeLabel(p.in),
        p.out === null ? '' : formatTimeLabel(p.out),
        formatDuration(minutos),
        formatDecimalHours(minutos),
        p.edited ? 'sí' : '',
        p.note ?? '',
      ]
    }),
  ]

  const ajustesRows = [
    ['Empleado', 'Fecha', 'Tipo', 'Monto', 'Nota'],
    ...cierre.adjustments.map((a) => [
      nombre(a.employeeId),
      a.day,
      TIPO_AJUSTE[a.kind],
      a.amount,
      a.note ?? '',
    ]),
  ]

  const resumen = buildPayrollSummary(cierre.employees, cierre.punches, cierre.adjustments, cierre.dayKey, cierre.nowMin)
  const resumenRows = [
    ['Empleado', 'Horas', 'Tarifa/hora', 'Salario por horas', 'Bonos', 'Descuentos', 'Total estimado'],
    ...resumen.map((r) => [
      nombre(r.employeeId),
      formatDecimalHours(r.minutes),
      r.hourlyWage,
      r.payFromHours,
      r.bonus,
      r.deduction,
      r.total,
    ]),
    [
      'TOTAL',
      '',
      '',
      resumen.reduce((acc, r) => acc + r.payFromHours, 0),
      resumen.reduce((acc, r) => acc + r.bonus, 0),
      resumen.reduce((acc, r) => acc + r.deduction, 0),
      resumen.reduce((acc, r) => acc + r.total, 0),
    ],
  ]

  const libro = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet(fichajesRows), 'Fichajes')
  XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet(ajustesRows), 'Compensaciones')
  XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet(resumenRows), 'Resumen por empleado')
  XLSX.writeFile(libro, nombreArchivoCierre(cierre.month))
}

type Nota = { tipo: 'error' | 'exito'; texto: string } | null

type EditorFichaje = {
  punch: Punch | null
  employeeId: string
  day: string
}

export function AdminDashboard({
  initial,
  username,
  mustChangePassword,
}: {
  initial: PanelData
  username: string
  mustChangePassword: boolean
}) {
  const router = useRouter()
  const [data, setData] = useState<PanelData>(initial)
  const [tab, setTab] = useState<Tab>('resumen')
  const [filtro, setFiltro] = useState<PanelFilter>({})
  const [nota, setNota] = useState<Nota>(null)
  const [debeCambiar, setDebeCambiar] = useState(mustChangePassword)
  const [editor, setEditor] = useState<EditorFichaje | null>(null)
  const [aBorrar, setABorrar] = useState<{ texto: string; ejecutar: () => Promise<void> } | null>(null)
  const [cerrandoMes, setCerrandoMes] = useState(false)
  const [cargando, startTransition] = useTransition()

  const nombrePorId = useMemo(() => {
    const map = new Map(data.employees.map((e) => [e.id, e.name]))
    return (id: string) => map.get(id) ?? 'Empleado eliminado'
  }, [data.employees])

  /**
   * Toda mutación termina releyendo el panel completo. Es una petición de más,
   * pero garantiza que lo que se ve en pantalla es lo que hay en la base:
   * en un sistema de horas, una interfaz optimista que miente es peor que una
   * que tarda medio segundo.
   */
  const refrescar = useCallback(
    (siguiente: PanelFilter = filtro) =>
      new Promise<void>((resolve) => {
        startTransition(async () => {
          try {
            const res = await cargarPanel(siguiente)
            if (res.ok) setData(res.data)
            else setNota({ tipo: 'error', texto: res.message })
          } catch {
            setNota({ tipo: 'error', texto: 'Se perdió la conexión con el servidor. Reintentá en unos segundos.' })
          }
          resolve()
        })
      }),
    [filtro],
  )

  /** Ejecuta una acción del servidor y traduce el resultado a un aviso. */
  const ejecutar = useCallback(
    (accion: () => Promise<{ ok: boolean; message?: string }>, exito: string) =>
      new Promise<boolean>((resolve) => {
        startTransition(async () => {
          try {
            const res = await accion()
            if (!res.ok) {
              setNota({ tipo: 'error', texto: res.message ?? 'No se pudo completar la operación.' })
              resolve(false)
              return
            }
            const recarga = await cargarPanel(filtro)
            if (recarga.ok) setData(recarga.data)
            setNota({ tipo: 'exito', texto: exito })
            resolve(true)
          } catch {
            setNota({ tipo: 'error', texto: 'Se perdió la conexión con el servidor. Reintentá en unos segundos.' })
            resolve(false)
          }
        })
      }),
    [filtro],
  )

  /**
   * A diferencia de `ejecutar`, el cierre de mes necesita los datos que borró
   * para armar el archivo de descarga: por eso no reusa ese helper genérico.
   */
  const confirmarCierreMes = useCallback(() => {
    startTransition(async () => {
      try {
        const res = await cerrarMes()
        if (!res.ok) {
          setNota({ tipo: 'error', texto: res.message })
          return
        }
        await descargarCierreMes(res.data)
        const recarga = await cargarPanel(filtro)
        if (recarga.ok) setData(recarga.data)
        setNota({ tipo: 'exito', texto: `Mes cerrado. Se descargó ${nombreArchivoCierre(res.data.month)}.` })
      } catch {
        setNota({ tipo: 'error', texto: 'Se perdió la conexión con el servidor. Reintentá en unos segundos.' })
      } finally {
        setCerrandoMes(false)
      }
    })
  }, [filtro])

  const dentroAhora = data.today.filter((p) => p.out === null).length
  const salidasHoy = data.today.filter((p) => p.out !== null).length
  const totalHoy = data.today.reduce((acc, p) => acc + workedMinutes(p, data.nowMin, true), 0)
  const activos = data.employees.filter((e) => e.active).length

  return (
    <main className="relative z-10 mx-auto flex min-h-dvh w-full max-w-6xl flex-col gap-6 px-5 py-6 sm:px-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            aria-label="Volver a la terminal de fichaje"
            className="glass flex size-10 items-center justify-center rounded-xl text-warning transition-all duration-200 hover:border-warning/60 hover:glow-edge-warning active:scale-95"
          >
            <ArrowLeft className="size-5" strokeWidth={1.6} />
          </Link>
          <div className="leading-tight">
            <h1 className="text-xl font-light tracking-tight sm:text-2xl">Panel - El Pirata VCP</h1>
            <p className="text-sm font-light tracking-wide text-muted-foreground">
              {formatLongDate(data.dayKey)} · {username}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Boton onClick={() => void refrescar()} loading={cargando} className="px-4 py-2.5">
            <RefreshCw className={cn('size-4', cargando && 'animate-spin')} strokeWidth={1.6} />
            <span className="hidden sm:inline">Actualizar</span>
          </Boton>
          <Boton
            variant="danger"
            onClick={() =>
              startTransition(async () => {
                await cerrarSesion()
                router.refresh()
              })
            }
            className="px-4 py-2.5"
          >
            <Power className="size-4" strokeWidth={1.6} />
            <span className="hidden sm:inline">Cerrar sesión</span>
          </Boton>
        </div>
      </header>

      {debeCambiar && (
        <Aviso
          tipo="error"
          action={
            <button
              type="button"
              onClick={() => setTab('cuenta')}
              className="shrink-0 underline underline-offset-4 hover:opacity-80"
            >
              Cambiar ahora
            </button>
          }
        >
          Estás usando la contraseña inicial. Cambiala antes de dejar el panel accesible desde internet.
        </Aviso>
      )}

      {data.pendientes.length > 0 && (
        <Aviso
          tipo="info"
          action={
            <button
              type="button"
              onClick={() => setTab('resumen')}
              className="shrink-0 underline underline-offset-4 hover:opacity-80"
            >
              Ver
            </button>
          }
        >
          Hay {data.pendientes.length} jornada{data.pendientes.length === 1 ? '' : 's'} de días anteriores sin hora de
          salida. Mientras no se corrijan, esas horas no suman en los totales.
        </Aviso>
      )}

      {nota && (
        <Aviso tipo={nota.tipo} onClose={() => setNota(null)}>
          {nota.texto}
        </Aviso>
      )}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat icon={<Users className="size-4" />} label="Empleados registrados" value={`${activos}`} />
        <Stat icon={<LogIn className="size-4" />} label="Dentro ahora" value={`${dentroAhora}`} highlight />
        <Stat icon={<LogIn className="size-4" />} label="Entradas hoy" value={`${data.today.length}`} />
        <Stat icon={<LogOut className="size-4" />} label="Salidas hoy" value={`${salidasHoy}`} />
        <Stat
          icon={<Clock3 className="size-4" />}
          label="Horas de hoy"
          value={formatDuration(totalHoy)}
          className="col-span-2 lg:col-span-1"
        />
      </section>

      <nav className="flex w-full gap-1 rounded-2xl border border-primary/20 bg-surface p-1.5 shadow-lg shadow-black/20 sm:w-fit">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              'flex-1 rounded-xl px-3 py-2.5 text-sm font-medium tracking-[0.14em] whitespace-nowrap uppercase transition-all duration-200 sm:flex-none sm:px-6',
              tab === t.id
                ? 'bg-primary/15 text-primary shadow-[inset_0_0_0_1px_oklch(0.72_0.168_245/45%)]'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === 'resumen' && (
        <TabResumen
          data={data}
          nombrePorId={nombrePorId}
          onEditar={(p) => setEditor({ punch: p, employeeId: p.employeeId, day: p.day })}
        />
      )}

      {tab === 'empleados' && (
        <TabEmpleados
          data={data}
          cargando={cargando}
          onCrear={(input) => ejecutar(() => crearEmpleado(input), `${input.name} quedó dado de alta.`)}
          onEditar={(id, cambios, mensaje) => ejecutar(() => editarEmpleado(id, cambios), mensaje)}
          onEliminar={(e) =>
            setABorrar({
              texto: `Vas a eliminar a ${e.name} y todos sus fichajes. Esta acción no se puede deshacer. Si solo dejó de trabajar acá, conviene darlo de baja: se conserva el historial.`,
              ejecutar: async () => {
                await ejecutar(() => eliminarEmpleado(e.id), `${e.name} fue eliminado.`)
              },
            })
          }
        />
      )}

      {tab === 'historial' && (
        <TabHistorial
          data={data}
          filtro={filtro}
          cargando={cargando}
          nombrePorId={nombrePorId}
          onFiltrar={(f) => {
            setFiltro(f)
            void refrescar(f)
          }}
          onNuevo={() => setEditor({ punch: null, employeeId: '', day: data.dayKey })}
          onEditar={(p) => setEditor({ punch: p, employeeId: p.employeeId, day: p.day })}
          onEliminar={(p) =>
            setABorrar({
              texto: `Vas a eliminar el fichaje de ${nombrePorId(p.employeeId)} del ${formatShortDate(p.day)}. Esta acción no se puede deshacer.`,
              ejecutar: async () => {
                await ejecutar(() => eliminarFichaje(p.id), 'Fichaje eliminado.')
              },
            })
          }
          onCerrarMes={() => setCerrandoMes(true)}
        />
      )}

      {tab === 'compensaciones' && (
        <TabCompensaciones
          data={data}
          cargando={cargando}
          nombrePorId={nombrePorId}
          onCrear={(input) => ejecutar(() => crearAjuste(input), 'Compensación cargada.')}
          onEliminar={(a) =>
            setABorrar({
              texto: `Vas a eliminar la compensación de ${nombrePorId(a.employeeId)} del ${formatShortDate(a.day)}. Esta acción no se puede deshacer.`,
              ejecutar: async () => {
                await ejecutar(() => eliminarAjuste(a.id), 'Compensación eliminada.')
              },
            })
          }
        />
      )}

      {tab === 'cuenta' && (
        <TabCuenta
          username={username}
          cargando={cargando}
          onCambiar={async (actual, nueva) => {
            const ok = await ejecutar(
              () => cambiarPassword(actual, nueva),
              'Contraseña actualizada.',
            )
            if (ok) setDebeCambiar(false)
            return ok
          }}
        />
      )}

      {editor && (
        <EditorFichajeModal
          empleados={data.employees}
          inicial={editor}
          hoy={data.dayKey}
          cargando={cargando}
          onClose={() => setEditor(null)}
          onGuardar={(input) =>
            new Promise<{ ok: boolean; message?: string }>((resolve) => {
              startTransition(async () => {
                try {
                  const res = await guardarFichaje(input)
                  if (!res.ok) {
                    resolve({ ok: false, message: res.message })
                    return
                  }
                  const recarga = await cargarPanel(filtro)
                  if (recarga.ok) setData(recarga.data)
                  setNota({ tipo: 'exito', texto: editor.punch ? 'Fichaje corregido.' : 'Fichaje cargado.' })
                  setEditor(null)
                  resolve({ ok: true })
                } catch {
                  resolve({
                    ok: false,
                    message: 'Se perdió la conexión con el servidor. Reintentá en unos segundos.',
                  })
                }
              })
            })
          }
        />
      )}

      {aBorrar && (
        <Modal title="¿Confirmás?" onClose={() => setABorrar(null)}>
          <p className="text-pretty text-sm font-light text-muted-foreground">{aBorrar.texto}</p>
          <div className="mt-7 flex justify-end gap-3">
            <Boton onClick={() => setABorrar(null)}>Cancelar</Boton>
            <Boton
              variant="danger"
              loading={cargando}
              onClick={async () => {
                await aBorrar.ejecutar()
                setABorrar(null)
              }}
            >
              Sí, eliminar
            </Boton>
          </div>
        </Modal>
      )}

      {cerrandoMes && (
        <Modal title="¿Cerrar el mes?" onClose={() => setCerrandoMes(false)}>
          <p className="text-pretty text-sm font-light text-muted-foreground">
            Se va a descargar un archivo <span className="font-mono">.xlsx</span> con todos los fichajes y
            compensaciones del mes en curso (desde el día 1 hasta hoy, {formatLongDate(data.dayKey)}), y después se
            van a borrar de la base para arrancar el mes que viene limpio. Guardá bien el archivo: es la única copia
            que va a quedar de estos registros.
          </p>
          <div className="mt-7 flex justify-end gap-3">
            <Boton onClick={() => setCerrandoMes(false)}>Cancelar</Boton>
            <Boton variant="danger" loading={cargando} onClick={confirmarCierreMes}>
              Sí, cerrar el mes
            </Boton>
          </div>
        </Modal>
      )}
    </main>
  )
}

/* --------------------------------- resumen -------------------------------- */

function TabResumen({
  data,
  nombrePorId,
  onEditar,
}: {
  data: PanelData
  nombrePorId: (id: string) => string
  onEditar: (p: Punch) => void
}) {
  const weekStart = startOfWeekKey(data.dayKey)
  const monthStart = startOfMonthKey(data.dayKey)

  const { horasSemana, horasMes, costoMes, netoCompensacionesMes, topEmpleados } = useMemo(() => {
    const punchesSemana = data.resumenGeneral.punches.filter((p) => p.day >= weekStart)
    const punchesMes = data.resumenGeneral.punches.filter((p) => p.day >= monthStart)
    const adjustmentsMes = data.resumenGeneral.adjustments.filter((a) => a.day >= monthStart)

    const horasSemana = punchesSemana.reduce((acc, p) => acc + workedMinutes(p, data.nowMin, p.day === data.dayKey), 0)
    const horasMes = punchesMes.reduce((acc, p) => acc + workedMinutes(p, data.nowMin, p.day === data.dayKey), 0)

    const payrollMes = buildPayrollSummary(data.employees, punchesMes, adjustmentsMes, data.dayKey, data.nowMin)
    const costoMes = payrollMes.reduce((acc, r) => acc + r.total, 0)
    const netoCompensacionesMes = payrollMes.reduce((acc, r) => acc + r.bonus - r.deduction, 0)
    const topEmpleados = [...payrollMes].sort((a, b) => b.minutes - a.minutes).slice(0, 5)

    return { horasSemana, horasMes, costoMes, netoCompensacionesMes, topEmpleados }
  }, [data.resumenGeneral, data.employees, data.dayKey, data.nowMin, weekStart, monthStart])

  return (
    <>
      <Panel title="Este mes, de un vistazo" hint="totales de horas y costo estimado del mes en curso">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat
            icon={<CalendarRange className="size-4" />}
            label="Horas esta semana"
            value={formatDuration(horasSemana)}
          />
          <Stat icon={<CalendarRange className="size-4" />} label="Horas este mes" value={formatDuration(horasMes)} />
          <Stat
            icon={<Wallet className="size-4" />}
            label="Costo estimado del mes"
            value={formatCurrency(costoMes)}
            highlight
          />
          <Stat
            icon={<Award className="size-4" />}
            label="Compensaciones netas"
            value={formatCurrency(netoCompensacionesMes)}
          />
        </div>
      </Panel>

      {topEmpleados.length > 0 && (
        <Panel title="Top empleados del mes" hint="quiénes hicieron más horas este mes">
          <Table
            head={['Empleado', 'Horas', 'Costo estimado']}
            rows={topEmpleados.map((r) => [
              <span key="n" className="font-light text-foreground">
                {nombrePorId(r.employeeId)}
              </span>,
              <span key="h" className="tnum font-mono text-muted-foreground">
                {formatDecimalHours(r.minutes)}
              </span>,
              <span key="c" className="tnum font-mono text-primary">
                {formatCurrency(r.total)}
              </span>,
            ])}
          />
        </Panel>
      )}

      {data.pendientes.length > 0 && (
        <Panel
          title={`Jornadas sin cerrar · ${data.pendientes.length}`}
          hint="fichajes de días anteriores a los que les falta la salida"
        >
          <Table
            head={['Empleado', 'Fecha', 'Entrada', 'Salida', '']}
            rows={data.pendientes.map((p) => [
              <span key="n" className="font-light text-foreground">{nombrePorId(p.employeeId)}</span>,
              <span key="d" className="font-light text-muted-foreground">
                {formatWeekday(p.day)} {formatShortDate(p.day)}
              </span>,
              <span key="i" className="tnum font-mono">{formatTimeLabel(p.in)}</span>,
              <span key="o" className="text-sm font-light text-destructive/90">Falta</span>,
              <div key="a" className="flex justify-end">
                <button
                  type="button"
                  onClick={() => onEditar(p)}
                  className="rounded-lg px-3 py-1.5 text-sm font-light text-primary transition-colors hover:underline"
                >
                  Corregir
                </button>
              </div>,
            ])}
          />
        </Panel>
      )}

      <Panel
        title={`Movimientos de hoy · ${formatLongDate(data.dayKey)}`}
        hint="entradas y salidas registradas hoy"
      >
        <Table
          head={['Empleado', 'Entrada', 'Salida', 'Trabajado', 'Estado', '']}
          rows={[...data.today]
            .sort((a, b) => b.in - a.in)
            .map((p) => [
              <span key="n" className="font-light text-foreground">{nombrePorId(p.employeeId)}</span>,
              <span key="i" className="tnum font-mono">{formatTimeLabel(p.in)}</span>,
              <span key="o" className="tnum font-mono text-muted-foreground">
                {p.out === null ? '· · ·' : formatTimeLabel(p.out)}
              </span>,
              <span key="t" className="tnum font-mono text-primary">
                {formatDuration(workedMinutes(p, data.nowMin, true))}
              </span>,
              <StatusPill key="s" open={p.out === null} />,
              <div key="a" className="flex justify-end">
                <button
                  type="button"
                  onClick={() => onEditar(p)}
                  aria-label="Corregir fichaje"
                  className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:text-primary"
                >
                  <Pencil className="size-4" strokeWidth={1.6} />
                </button>
              </div>,
            ])}
        />
      </Panel>
    </>
  )
}

/* -------------------------------- empleados ------------------------------- */

function TabEmpleados({
  data,
  cargando,
  onCrear,
  onEditar,
  onEliminar,
}: {
  data: PanelData
  cargando: boolean
  onCrear: (input: { name: string; pin: string; department?: string; hourlyWage?: number }) => Promise<boolean>
  onEditar: (id: string, cambios: Record<string, unknown>, mensaje: string) => Promise<boolean>
  onEliminar: (e: Employee) => void
}) {
  const [name, setName] = useState('')
  const [pin, setPin] = useState('')
  const [department, setDepartment] = useState('')
  const [hourlyWage, setHourlyWage] = useState('')
  const [enEdicion, setEnEdicion] = useState<Employee | null>(null)

  const dentro = (id: string) => data.today.some((p) => p.employeeId === id && p.out === null)

  async function alta(e: React.FormEvent) {
    e.preventDefault()
    const ok = await onCrear({ name, pin, department, hourlyWage: Number(hourlyWage) || 0 })
    if (ok) {
      setName('')
      setPin('')
      setDepartment('')
      setHourlyWage('')
    }
  }

  return (
    <>
      <Panel title="Alta de empleado" hint="cargar un empleado nuevo" variant="warning">
        <form onSubmit={alta} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_0.6fr_auto]">
          <Field label="Nombre y apellido" value={name} onChange={setName} placeholder="Ana Gutiérrez" />
          <Field
            label="Salario por hora"
            type="number"
            value={hourlyWage}
            onChange={(v) => setHourlyWage(limitarMonto(v))}
            placeholder="0"
            max={MONTO_MAXIMO}
            mono
          />
          <Field label="Sector" value={department} onChange={setDepartment} placeholder="Producción" />
          <Field
            label="PIN"
            value={pin}
            onChange={(v) => setPin(v.replace(/\D/g, '').slice(0, 4))}
            placeholder="0000"
            inputMode="numeric"
            mono
          />
          <div className="flex items-end">
            <Boton type="submit" variant="primary" loading={cargando} className="w-full">
              <UserPlus className="size-4" strokeWidth={1.7} />
              Dar de alta
            </Boton>
          </div>
        </form>
        <p className="mt-4 text-sm font-light text-muted-foreground/70">
          El PIN se guarda cifrado y no se puede volver a ver: si un empleado lo olvida, se le asigna uno nuevo desde
          esta misma tabla.
        </p>
      </Panel>

      <Panel title={`Empleados · ${data.employees.length}`} hint="listado, edición y baja del personal">
        <Table
          head={['Empleado', 'Salario/hora', 'Sector', 'Estado', '']}
          rows={data.employees.map((e) => [
            <span key="n" className={cn('font-light', e.active ? 'text-foreground' : 'text-muted-foreground')}>
              {e.name}
            </span>,
            <span key="w" className="tnum font-mono text-muted-foreground">{formatCurrency(e.hourlyWage)}</span>,
            <span key="d" className="font-light text-muted-foreground">{e.department}</span>,
            e.active ? (
              <StatusPill key="s" open={dentro(e.id)} />
            ) : (
              <span key="s" className="text-sm font-light text-destructive/90">De baja</span>
            ),
            <div key="a" className="flex justify-end gap-1">
              <button
                type="button"
                onClick={() => setEnEdicion(e)}
                aria-label={`Editar ${e.name}`}
                className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:text-primary"
              >
                <Pencil className="size-4" strokeWidth={1.6} />
              </button>
              <button
                type="button"
                onClick={() =>
                  onEditar(
                    e.id,
                    { active: !e.active },
                    e.active ? `${e.name} quedó de baja.` : `${e.name} fue reactivado.`,
                  )
                }
                className="rounded-lg px-2 py-1 text-sm font-light text-muted-foreground transition-colors hover:text-primary"
              >
                {e.active ? 'Dar de baja' : 'Reactivar'}
              </button>
              <button
                type="button"
                onClick={() => onEliminar(e)}
                aria-label={`Eliminar ${e.name}`}
                className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:text-destructive"
              >
                <Trash2 className="size-4" strokeWidth={1.6} />
              </button>
            </div>,
          ])}
        />
      </Panel>

      {enEdicion && (
        <EditorEmpleadoModal
          empleado={enEdicion}
          cargando={cargando}
          onClose={() => setEnEdicion(null)}
          onGuardar={async (cambios) => {
            const ok = await onEditar(enEdicion.id, cambios, `Datos de ${enEdicion.name} actualizados.`)
            if (ok) setEnEdicion(null)
            return ok
          }}
        />
      )}
    </>
  )
}

function EditorEmpleadoModal({
  empleado,
  cargando,
  onClose,
  onGuardar,
}: {
  empleado: Employee
  cargando: boolean
  onClose: () => void
  onGuardar: (cambios: Record<string, unknown>) => Promise<boolean>
}) {
  const [name, setName] = useState(empleado.name)
  const [hourlyWage, setHourlyWage] = useState(String(empleado.hourlyWage))
  const [department, setDepartment] = useState(empleado.department)
  const [pin, setPin] = useState('')

  return (
    <Modal
      title="Editar empleado"
      subtitle="Dejá el PIN vacío para conservar el que ya tiene."
      onClose={onClose}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          void onGuardar({
            name,
            hourlyWage: Number(hourlyWage) || 0,
            department,
            ...(pin ? { pin } : {}),
          })
        }}
      >
        <Field label="Nombre y apellido" value={name} onChange={setName} autoFocus />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Salario por hora"
            type="number"
            value={hourlyWage}
            onChange={(v) => setHourlyWage(limitarMonto(v))}
            max={MONTO_MAXIMO}
            mono
          />
          <Field label="Sector" value={department} onChange={setDepartment} />
        </div>
        <Field
          label="PIN nuevo (opcional)"
          value={pin}
          onChange={(v) => setPin(v.replace(/\D/g, '').slice(0, 4))}
          placeholder="Sin cambios"
          inputMode="numeric"
          mono
        />
        <div className="mt-2 flex justify-end gap-3">
          <Boton onClick={onClose}>Cancelar</Boton>
          <Boton type="submit" variant="primary" loading={cargando}>
            Guardar cambios
          </Boton>
        </div>
      </form>
    </Modal>
  )
}

/* -------------------------------- historial ------------------------------- */

function TabHistorial({
  data,
  filtro,
  cargando,
  nombrePorId,
  onFiltrar,
  onNuevo,
  onEditar,
  onEliminar,
  onCerrarMes,
}: {
  data: PanelData
  filtro: PanelFilter
  cargando: boolean
  nombrePorId: (id: string) => string
  onFiltrar: (f: PanelFilter) => void
  onNuevo: () => void
  onEditar: (p: Punch) => void
  onEliminar: (p: Punch) => void
  onCerrarMes: () => void
}) {
  const [borrador, setBorrador] = useState<PanelFilter>(filtro)

  const total = data.punches.reduce(
    (acc, p) => acc + workedMinutes(p, data.nowMin, p.day === data.dayKey),
    0,
  )

  // Un fichaje sin salida en este rango deja el archivo exportado incompleto
  // para siempre: mejor bloquear la descarga que dejar salir un número que
  // después no coincide con lo que se cobró.
  const abiertos = data.punches.filter((p) => p.out === null)
  const bloqueadoPorAbiertos = abiertos.length > 0

  const wagePorId = useMemo(() => {
    const map = new Map(data.employees.map((e) => [e.id, e.hourlyWage]))
    return (id: string) => map.get(id) ?? 0
  }, [data.employees])

  const resumen = useMemo(
    () => buildPayrollSummary(data.employees, data.punches, data.adjustments, data.dayKey, data.nowMin),
    [data.employees, data.punches, data.adjustments, data.dayKey, data.nowMin],
  )
  const totalEstimado = resumen.reduce((acc, r) => acc + r.total, 0)

  function exportarCsv() {
    const filas = data.punches.map((p) => {
      const minutos = workedMinutes(p, data.nowMin, p.day === data.dayKey)
      return [
        nombrePorId(p.employeeId),
        p.day,
        formatTimeLabel(p.in),
        p.out === null ? '' : formatTimeLabel(p.out),
        formatDuration(minutos),
        formatDecimalHours(minutos),
        p.edited ? 'sí' : '',
        (p.note ?? '').replace(/[;\r\n]/g, ' '),
      ].join(';')
    })

    const csv = ['Empleado;Fecha;Entrada;Salida;Trabajado;Horas decimales;Corregido;Nota', ...filas].join('\r\n')

    // El BOM es lo que hace que Excel en español abra el archivo con los
    // acentos correctos en vez de "GutiÃ©rrez".
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `fichajes-${filtro.from ?? 'inicio'}-a-${filtro.to ?? data.dayKey}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function exportarPdf() {
    const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
      import('jspdf'),
      import('jspdf-autotable'),
    ])

    const doc = new jsPDF()
    const rango = `${filtro.from ?? 'inicio'} a ${filtro.to ?? data.dayKey}`

    doc.setFontSize(14)
    doc.text('Fichaje - El Pirata VCP · Historial', 14, 16)
    doc.setFontSize(9)
    doc.setTextColor(120)
    doc.text(rango, 14, 22)

    autoTable(doc, {
      startY: 28,
      head: [['Empleado', 'Fecha', 'Entrada', 'Salida', 'Trabajado', 'Salario estimado']],
      body: data.punches.map((p) => {
        const minutos = workedMinutes(p, data.nowMin, p.day === data.dayKey)
        return [
          nombrePorId(p.employeeId),
          `${formatWeekday(p.day)} ${formatShortDate(p.day)}`,
          formatTimeLabel(p.in),
          p.out === null ? '· · ·' : formatTimeLabel(p.out),
          formatDuration(minutos),
          formatCurrency(estimatedPay(minutos, wagePorId(p.employeeId))),
        ]
      }),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [30, 41, 59] },
    })

    const finalY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY

    doc.setFontSize(11)
    doc.setTextColor(0)
    doc.text('Resumen de sueldos', 14, finalY + 10)

    autoTable(doc, {
      startY: finalY + 14,
      head: [['Empleado', 'Horas', 'Tarifa/hora', 'Salario por horas', 'Bonos', 'Descuentos', 'Total estimado']],
      body: resumen.map((r) => [
        nombrePorId(r.employeeId),
        formatDecimalHours(r.minutes),
        formatCurrency(r.hourlyWage),
        formatCurrency(r.payFromHours),
        formatCurrency(r.bonus),
        formatCurrency(r.deduction),
        formatCurrency(r.total),
      ]),
      foot: [
        [
          'Total',
          '',
          '',
          formatCurrency(resumen.reduce((acc, r) => acc + r.payFromHours, 0)),
          formatCurrency(resumen.reduce((acc, r) => acc + r.bonus, 0)),
          formatCurrency(resumen.reduce((acc, r) => acc + r.deduction, 0)),
          formatCurrency(totalEstimado),
        ],
      ],
      styles: { fontSize: 8 },
      headStyles: { fillColor: [30, 41, 59] },
      footStyles: { fillColor: [226, 232, 240], textColor: 0, fontStyle: 'bold' },
    })

    doc.save(`historial-${filtro.from ?? 'inicio'}-a-${filtro.to ?? data.dayKey}.pdf`)
  }

  return (
    <>
      <Panel
        title={`Resumen de sueldos · ${formatCurrency(totalEstimado)}`}
        hint="estimación de costo laboral del rango filtrado"
      >
        {resumen.length === 0 ? (
          <p className="py-6 text-center text-sm font-light text-muted-foreground">
            No hay horas ni compensaciones en este rango todavía.
          </p>
        ) : (
          <Table
            head={['Empleado', 'Horas', 'Tarifa/hora', 'Salario por horas', 'Bonos', 'Descuentos', 'Total estimado']}
            rows={[
              ...resumen.map((r) => [
                <span key="n" className="font-light text-foreground">{nombrePorId(r.employeeId)}</span>,
                <span key="h" className="tnum font-mono text-muted-foreground">{formatDecimalHours(r.minutes)}</span>,
                <span key="w" className="tnum font-mono text-muted-foreground">{formatCurrency(r.hourlyWage)}</span>,
                <span key="p" className="tnum font-mono">{formatCurrency(r.payFromHours)}</span>,
                <span key="b" className="tnum font-mono text-primary">
                  {r.bonus > 0 ? `+${formatCurrency(r.bonus)}` : '—'}
                </span>,
                <span key="d" className="tnum font-mono text-destructive/90">
                  {r.deduction > 0 ? `−${formatCurrency(r.deduction)}` : '—'}
                </span>,
                <span key="t" className="tnum font-mono font-medium text-primary">{formatCurrency(r.total)}</span>,
              ]),
              [
                <span key="n" className="font-medium text-foreground">Total</span>,
                <span key="h" />,
                <span key="w" />,
                <span key="p" className="tnum font-mono">
                  {formatCurrency(resumen.reduce((acc, r) => acc + r.payFromHours, 0))}
                </span>,
                <span key="b" className="tnum font-mono text-primary">
                  {formatCurrency(resumen.reduce((acc, r) => acc + r.bonus, 0))}
                </span>,
                <span key="d" className="tnum font-mono text-destructive/90">
                  {formatCurrency(resumen.reduce((acc, r) => acc + r.deduction, 0))}
                </span>,
                <span key="t" className="tnum font-mono font-medium text-primary">{formatCurrency(totalEstimado)}</span>,
              ],
            ]}
          />
        )}
      </Panel>

      <Panel
        title={`Historial · ${data.punches.length} registros · ${formatDuration(total)}`}
        hint="todos los fichajes del rango, filtrables y exportables"
        action={
          <div className="flex flex-wrap gap-2">
            <Boton onClick={onNuevo} variant="success" className="px-4 py-2">
              <CalendarPlus className="size-4" strokeWidth={1.6} />
              Cargar fichaje
            </Boton>
            <Boton
              onClick={exportarCsv}
              disabled={data.punches.length === 0 || bloqueadoPorAbiertos}
              className="px-4 py-2"
            >
              <Download className="size-4" strokeWidth={1.6} />
              Exportar CSV
            </Boton>
            <Boton
              onClick={exportarPdf}
              disabled={data.punches.length === 0 || bloqueadoPorAbiertos}
              className="px-4 py-2"
            >
              <FileText className="size-4" strokeWidth={1.6} />
              Exportar PDF
            </Boton>
            <Boton onClick={onCerrarMes} variant="danger" className="px-4 py-2">
              <Archive className="size-4" strokeWidth={1.6} />
              Cerrar mes
            </Boton>
          </div>
        }
      >
        {bloqueadoPorAbiertos && (
          <Aviso tipo="info">
            No se puede exportar mientras haya fichajes sin salida en este rango:{' '}
            {[...new Set(abiertos.map((p) => nombrePorId(p.employeeId)))].join(', ')}. Esperá a que fichen la
            salida o corregilo desde la tabla de abajo. El cierre de mes tiene la misma restricción, pero se
            evalúa sobre el mes en curso, no sobre este filtro.
          </Aviso>
        )}

        <form
        className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_auto]"
        onSubmit={(e) => {
          e.preventDefault()
          onFiltrar(borrador)
        }}
      >
        <Select
          label="Empleado"
          value={borrador.employeeId ?? ''}
          onChange={(v) => setBorrador({ ...borrador, employeeId: v || undefined })}
        >
          <option value="">Todos</option>
          {data.employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </Select>
        <Field
          label="Desde"
          type="date"
          value={borrador.from ?? ''}
          onChange={(v) => setBorrador({ ...borrador, from: v || undefined })}
        />
        <Field
          label="Hasta"
          type="date"
          value={borrador.to ?? ''}
          onChange={(v) => setBorrador({ ...borrador, to: v || undefined })}
        />
        <div className="flex items-end">
          <Boton type="submit" variant="primary" loading={cargando} className="w-full">
            Aplicar
          </Boton>
        </div>
      </form>

      <Table
        head={['Empleado', 'Fecha', 'Entrada', 'Salida', 'Trabajado', '']}
        rows={data.punches.map((p) => [
          <span key="n" className="font-light text-foreground">
            {nombrePorId(p.employeeId)}
            {p.edited && (
              <span
                className="ml-2 rounded-full bg-foreground/5 px-2 py-0.5 text-sm tracking-wider text-muted-foreground uppercase"
                title={p.note ?? 'Cargado o corregido desde el panel'}
              >
                corregido
              </span>
            )}
          </span>,
          <span key="d" className="font-light whitespace-nowrap text-muted-foreground">
            {formatWeekday(p.day)} {formatShortDate(p.day)}
          </span>,
          <span key="i" className="tnum font-mono">{formatTimeLabel(p.in)}</span>,
          <span key="o" className="tnum font-mono text-muted-foreground">
            {p.out === null ? '· · ·' : formatTimeLabel(p.out)}
          </span>,
          <span key="t" className="tnum font-mono text-primary">
            {p.out === null && p.day !== data.dayKey
              ? '—'
              : formatDuration(workedMinutes(p, data.nowMin, p.day === data.dayKey))}
          </span>,
          <div key="a" className="flex justify-end gap-1">
            <button
              type="button"
              onClick={() => onEditar(p)}
              aria-label="Editar fichaje"
              className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:text-primary"
            >
              <Pencil className="size-4" strokeWidth={1.6} />
            </button>
            <button
              type="button"
              onClick={() => onEliminar(p)}
              aria-label="Eliminar fichaje"
              className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:text-destructive"
            >
              <Trash2 className="size-4" strokeWidth={1.6} />
            </button>
          </div>,
        ])}
      />
      </Panel>
    </>
  )
}

/* ----------------------------- compensaciones ------------------------------ */

function TabCompensaciones({
  data,
  cargando,
  nombrePorId,
  onCrear,
  onEliminar,
}: {
  data: PanelData
  cargando: boolean
  nombrePorId: (id: string) => string
  onCrear: (input: {
    employeeId: string
    day: string
    kind: Adjustment['kind']
    amount: number
    nota?: string
  }) => Promise<boolean>
  onEliminar: (a: Adjustment) => void
}) {
  const [employeeId, setEmployeeId] = useState('')
  const [kind, setKind] = useState<Adjustment['kind']>('bonus')
  const [amount, setAmount] = useState('')
  const [day, setDay] = useState(data.dayKey)
  const [nota, setNota] = useState('')

  async function alta(e: React.FormEvent) {
    e.preventDefault()
    const ok = await onCrear({ employeeId, day, kind, amount: Number(amount) || 0, nota })
    if (ok) {
      setAmount('')
      setNota('')
    }
  }

  const totalBonos = data.adjustments.filter((a) => a.kind === 'bonus').reduce((acc, a) => acc + a.amount, 0)
  const totalDescuentos = data.adjustments.filter((a) => a.kind === 'deduction').reduce((acc, a) => acc + a.amount, 0)

  return (
    <>
      <Panel title="Nueva compensación" hint="cargar un bono o un descuento">
        <form onSubmit={alta} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1.3fr_1fr_0.8fr_0.9fr_1.3fr_auto]">
          <Select label="Empleado" value={employeeId} onChange={setEmployeeId}>
            <option value="">Elegí un empleado…</option>
            {data.employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
                {e.active ? '' : ' (de baja)'}
              </option>
            ))}
          </Select>
          <Select label="Tipo" value={kind} onChange={(v) => setKind(v as Adjustment['kind'])}>
            <option value="bonus">{TIPO_AJUSTE.bonus}</option>
            <option value="deduction">{TIPO_AJUSTE.deduction}</option>
          </Select>
          <Field
            label="Monto"
            type="number"
            value={amount}
            onChange={(v) => setAmount(limitarMonto(v))}
            placeholder="0"
            max={MONTO_MAXIMO}
            mono
          />
          <Field label="Fecha" type="date" value={day} onChange={setDay} />
          <Field
            label="Nota"
            value={nota}
            onChange={setNota}
            placeholder={kind === 'bonus' ? 'Vendió $50.000 extra en el mes' : 'Rompió una máquina de café'}
          />
          <div className="flex items-end">
            <Boton type="submit" variant="primary" loading={cargando} className="w-full">
              {kind === 'bonus' ? <Plus className="size-4" strokeWidth={1.7} /> : <Minus className="size-4" strokeWidth={1.7} />}
              Cargar
            </Boton>
          </div>
        </form>
        <p className="mt-4 text-sm font-light text-muted-foreground/70">
          Los bonos suman y los descuentos restan del salario estimado que se ve en Historial y en el cierre de mes.
        </p>
      </Panel>

      <Panel
        title={`Compensaciones · ${data.adjustments.length}`}
        hint="bonos y descuentos cargados"
        action={
          <div className="flex gap-4 text-sm font-light text-muted-foreground">
            <span>
              Bonos <span className="tnum font-mono text-primary">+{formatCurrency(totalBonos)}</span>
            </span>
            <span>
              Descuentos <span className="tnum font-mono text-destructive/90">−{formatCurrency(totalDescuentos)}</span>
            </span>
          </div>
        }
      >
        <Table
          head={['Empleado', 'Fecha', 'Tipo', 'Monto', 'Nota', '']}
          rows={data.adjustments.map((a) => [
            <span key="n" className="font-light text-foreground">{nombrePorId(a.employeeId)}</span>,
            <span key="d" className="font-light whitespace-nowrap text-muted-foreground">
              {formatWeekday(a.day)} {formatShortDate(a.day)}
            </span>,
            <span
              key="k"
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-light whitespace-nowrap',
                a.kind === 'bonus'
                  ? 'bg-primary/12 text-primary shadow-[inset_0_0_0_1px_oklch(0.72_0.168_245/45%)]'
                  : 'bg-destructive/10 text-destructive shadow-[inset_0_0_0_1px_oklch(0.65_0.2_25/35%)]',
              )}
            >
              {TIPO_AJUSTE[a.kind]}
            </span>,
            <span key="m" className={cn('tnum font-mono', a.kind === 'bonus' ? 'text-primary' : 'text-destructive/90')}>
              {a.kind === 'bonus' ? '+' : '−'}
              {formatCurrency(a.amount)}
            </span>,
            <span key="o" className="font-light text-muted-foreground">{a.note ?? ''}</span>,
            <div key="a" className="flex justify-end">
              <button
                type="button"
                onClick={() => onEliminar(a)}
                aria-label="Eliminar compensación"
                className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:text-destructive"
              >
                <Trash2 className="size-4" strokeWidth={1.6} />
              </button>
            </div>,
          ])}
        />
      </Panel>
    </>
  )
}

/* ------------------------- editor de fichaje (modal) ------------------------ */

function EditorFichajeModal({
  empleados,
  inicial,
  hoy,
  cargando,
  onClose,
  onGuardar,
}: {
  empleados: Employee[]
  inicial: EditorFichaje
  hoy: string
  cargando: boolean
  onClose: () => void
  onGuardar: (input: {
    id?: string
    employeeId: string
    day: string
    entrada: string
    salida: string
    nota?: string
  }) => Promise<{ ok: boolean; message?: string }>
}) {
  const outInicial = inicial.punch?.out ?? null
  const cruzaInicial = crossesMidnight(outInicial)

  const [employeeId, setEmployeeId] = useState(inicial.employeeId)
  const [day, setDay] = useState(inicial.day)
  const [entrada, setEntrada] = useState(toTimeInput(inicial.punch?.in))
  const [salida, setSalida] = useState(
    outInicial === null ? '' : toTimeInput(cruzaInicial ? outInicial - 1440 : outInicial),
  )
  const [cruzaDia, setCruzaDia] = useState(cruzaInicial)
  const [nota, setNota] = useState(inicial.punch?.note ?? '')
  const [error, setError] = useState<string | null>(null)

  const editando = inicial.punch !== null

  // Si se vacía la salida y se vuelve a tipear una sin re-tildar la casilla,
  // "cruza el día" quedaría marcado de una corrección anterior y sumaría
  // 1440 minutos de más sin ningún aviso.
  function cambiarSalida(v: string) {
    setSalida(v)
    if (v.trim() === '') setCruzaDia(false)
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const salidaFinal =
      salida.trim() === '' ? '' : toTimeInput((parseTimeInput(salida) ?? 0) + (cruzaDia ? 1440 : 0))

    const res = await onGuardar({ id: inicial.punch?.id, employeeId, day, entrada, salida: salidaFinal, nota })
    if (!res.ok) setError(res.message ?? 'No se pudo guardar el fichaje.')
  }

  return (
    <Modal
      title={editando ? 'Corregir fichaje' : 'Cargar fichaje'}
      subtitle={
        editando
          ? 'Queda marcado como corregido en el historial y en el CSV.'
          : 'Para cuando alguien se olvidó de fichar, o para cargar un turno adicional del mismo día (horario cortado).'
      }
      onClose={onClose}
    >
      <form className="flex flex-col gap-4" onSubmit={enviar}>
        <Select label="Empleado" value={employeeId} onChange={setEmployeeId}>
          <option value="">Elegí un empleado…</option>
          {empleados.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
              {e.active ? '' : ' (de baja)'}
            </option>
          ))}
        </Select>

        <Field label="Fecha" type="date" value={day} onChange={setDay} />

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Entrada" type="time" value={entrada} onChange={setEntrada} mono />
          <Field label="Salida" type="time" value={salida} onChange={cambiarSalida} mono />
        </div>

        <label className="flex items-center gap-2 text-sm font-light text-muted-foreground">
          <input
            type="checkbox"
            checked={cruzaDia}
            onChange={(e) => setCruzaDia(e.target.checked)}
            disabled={salida.trim() === ''}
            className="size-4 rounded border-border/70 accent-primary disabled:opacity-50"
          />
          El turno termina al día siguiente
        </label>

        <p className="text-sm font-light text-muted-foreground/70">
          Dejá la salida vacía para dejar la jornada abierta. Si el turno cruza la medianoche (por ejemplo, entra a
          las 22:00 y sale a las 02:00), tildá la casilla de arriba: la salida queda guardada como{' '}
          <span className="tnum font-mono">02:00 +1</span>.
        </p>

        <Field label="Nota (opcional)" value={nota} onChange={setNota} placeholder="Olvidó fichar la salida" />

        {error && (
          <Aviso tipo="error" onClose={() => setError(null)}>
            {error}
          </Aviso>
        )}

        <div className="mt-2 flex justify-end gap-3">
          <Boton onClick={onClose}>Cancelar</Boton>
          <Boton type="submit" variant="primary" loading={cargando} disabled={day > hoy}>
            Guardar
          </Boton>
        </div>
      </form>
    </Modal>
  )
}

/* ---------------------------------- cuenta -------------------------------- */

function TabCuenta({
  username,
  cargando,
  onCambiar,
}: {
  username: string
  cargando: boolean
  onCambiar: (actual: string, nueva: string) => Promise<boolean>
}) {
  const [actual, setActual] = useState('')
  const [nueva, setNueva] = useState('')
  const [repetida, setRepetida] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (nueva.length < 8) return setError('La contraseña nueva tiene que tener al menos 8 caracteres.')
    if (nueva !== repetida) return setError('Las contraseñas nuevas no coinciden.')

    const ok = await onCambiar(actual, nueva)
    if (ok) {
      setActual('')
      setNueva('')
      setRepetida('')
    }
  }

  return (
    <Panel
      title={`Mi cuenta · ${username}`}
      hint="cambiar tu contraseña de acceso al panel"
      variant="success"
    >
      <form onSubmit={enviar} className="flex max-w-md flex-col gap-4">
        <Field label="Contraseña actual" type="password" value={actual} onChange={setActual} />
        <Field label="Contraseña nueva" type="password" value={nueva} onChange={setNueva} />
        <Field label="Repetir contraseña nueva" type="password" value={repetida} onChange={setRepetida} />

        {error && <Aviso tipo="error">{error}</Aviso>}

        <Boton type="submit" variant="primary" loading={cargando} className="self-start">
          Cambiar contraseña
        </Boton>
      </form>
    </Panel>
  )
}
