'use client'

import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Eye, EyeOff, Info, Loader2, X } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Piezas visuales compartidas del panel. Nada de lógica de negocio acá. */

export function Panel({
  title,
  hint,
  action,
  variant,
  children,
}: {
  title: string
  /** Explicación breve de qué hace la tarjeta, se muestra entre paréntesis junto al título. */
  hint?: string
  action?: React.ReactNode
  /** Resalta la tarjeta cuando conviene diferenciarla del resto del panel. */
  variant?: 'warning' | 'success'
  children: React.ReactNode
}) {
  return (
    <section
      className={cn(
        'glass animate-rise rounded-3xl p-5 sm:p-7',
        variant === 'warning' && 'border-warning/50 glow-edge-warning',
        variant === 'success' && 'border-success/50 glow-edge-success',
      )}
    >
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm tracking-[0.28em] text-muted-foreground uppercase">
          {title}
          {hint && <span className="ml-2 font-light normal-case tracking-normal text-muted-foreground/50">({hint})</span>}
        </h2>
        {action}
      </div>
      {children}
    </section>
  )
}

export function Stat({
  icon,
  label,
  value,
  highlight,
  className,
}: {
  icon: React.ReactNode
  label: string
  value: string
  highlight?: boolean
  className?: string
}) {
  return (
    <div className={cn('glass min-w-0 rounded-2xl p-4', highlight && 'border-primary/45 glow-edge', className)}>
      <div className="flex items-center gap-2 text-muted-foreground">
        <span className={highlight ? 'text-primary' : ''}>{icon}</span>
        <span className="text-sm tracking-[0.18em] uppercase">{label}</span>
      </div>
      <p
        className={cn(
          'tnum mt-2 font-mono text-3xl font-light [overflow-wrap:anywhere]',
          highlight && 'text-primary text-glow',
        )}
      >
        {value}
      </p>
    </div>
  )
}

export function StatusPill({ open, label }: { open: boolean; label?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-light whitespace-nowrap',
        open
          ? 'bg-primary/12 text-primary shadow-[inset_0_0_0_1px_oklch(0.72_0.168_245/45%)]'
          : 'bg-foreground/5 text-muted-foreground shadow-[inset_0_0_0_1px_oklch(1_0_0/8%)]',
      )}
    >
      <span className={cn('size-1.5 rounded-full', open ? 'bg-primary' : 'bg-muted-foreground/60')} />
      {label ?? (open ? 'Dentro' : 'Fuera')}
    </span>
  )
}

type AvisoTipo = 'error' | 'exito' | 'info'

const AVISO_ICON = { error: AlertTriangle, exito: CheckCircle2, info: Info }

export function Aviso({
  tipo,
  children,
  onClose,
  action,
}: {
  tipo: AvisoTipo
  children: React.ReactNode
  onClose?: () => void
  action?: React.ReactNode
}) {
  const Icon = AVISO_ICON[tipo]
  return (
    <div
      role={tipo === 'error' ? 'alert' : 'status'}
      className={cn(
        'glass flex items-start gap-3 rounded-2xl px-4 py-3 text-sm font-light',
        tipo === 'error' && 'border-destructive/50 text-destructive',
        tipo === 'exito' && 'border-primary/50 text-primary',
        tipo === 'info' && 'text-muted-foreground',
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" strokeWidth={1.7} />
      <div className="flex-1 text-pretty">{children}</div>
      {action}
      {onClose && (
        <button type="button" onClick={onClose} aria-label="Cerrar aviso" className="shrink-0 opacity-70 hover:opacity-100">
          <X className="size-4" />
        </button>
      )}
    </div>
  )
}

export function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse text-sm">
        <thead>
          <tr>
            {head.map((h, i) => (
              <th
                key={i}
                className={cn(
                  'border-b border-border/70 pb-3 text-left text-sm font-normal tracking-[0.18em] text-muted-foreground uppercase',
                  i === head.length - 1 && h === '' && 'text-right',
                )}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={head.length} className="py-10 text-center font-light text-muted-foreground">
                No hay registros para mostrar.
              </td>
            </tr>
          ) : (
            rows.map((cells, i) => (
              <tr key={i} className="transition-colors duration-150 hover:bg-primary/5">
                {cells.map((c, j) => (
                  <td key={j} className="border-b border-border/40 py-3.5 pr-4 align-middle last:pr-0">
                    {c}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

export function Field({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  mono,
  inputMode,
  maxLength,
  max,
  autoFocus,
}: {
  label?: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
  mono?: boolean
  inputMode?: 'text' | 'numeric'
  maxLength?: number
  max?: number
  autoFocus?: boolean
}) {
  const [visible, setVisible] = useState(false)
  const esPassword = type === 'password'

  return (
    <label className="flex flex-col gap-1.5">
      {label && (
        <span className="text-sm tracking-[0.18em] text-muted-foreground uppercase">{label}</span>
      )}
      <div className="relative">
        <input
          type={esPassword && visible ? 'text' : type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          inputMode={inputMode}
          maxLength={maxLength}
          max={max}
          autoFocus={autoFocus}
          className={cn(
            'glass w-full rounded-xl px-4 py-3 text-sm font-light text-foreground transition-all duration-200 placeholder:text-muted-foreground/70 focus:border-primary/60 focus:glow-edge focus:outline-none',
            esPassword && 'pr-11',
            mono && 'tnum font-mono',
            (type === 'date' || type === 'time') &&
              '[&::-webkit-calendar-picker-indicator]:opacity-50 [&::-webkit-calendar-picker-indicator]:invert',
          )}
        />
        {esPassword && (
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
            tabIndex={-1}
            className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground transition-colors hover:text-foreground"
          >
            {visible ? <EyeOff className="size-4" strokeWidth={1.6} /> : <Eye className="size-4" strokeWidth={1.6} />}
          </button>
        )}
      </div>
    </label>
  )
}

export function Select({
  label,
  value,
  onChange,
  children,
}: {
  label?: string
  value: string
  onChange: (v: string) => void
  children: React.ReactNode
}) {
  return (
    <label className="flex flex-col gap-1.5">
      {label && (
        <span className="text-sm tracking-[0.18em] text-muted-foreground uppercase">{label}</span>
      )}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="glass w-full rounded-xl px-4 py-3 text-sm font-light text-foreground transition-all duration-200 focus:border-primary/60 focus:outline-none [&>option]:bg-popover"
      >
        {children}
      </select>
    </label>
  )
}

export function Boton({
  children,
  onClick,
  type = 'button',
  variant = 'ghost',
  disabled,
  loading,
  className,
}: {
  children: React.ReactNode
  onClick?: () => void
  type?: 'button' | 'submit'
  variant?: 'ghost' | 'primary' | 'success' | 'danger'
  disabled?: boolean
  loading?: boolean
  className?: string
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      className={cn(
        'glass flex items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-light tracking-wide whitespace-nowrap transition-all duration-200',
        'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50',
        variant === 'ghost' && 'text-muted-foreground hover:border-primary/50 hover:text-foreground',
        variant === 'primary' && 'border-primary/55 font-medium text-primary hover:glow-edge hover:border-primary',
        variant === 'success' && 'border-success/55 font-medium text-success hover:glow-edge-success hover:border-success',
        variant === 'danger' && 'text-destructive hover:border-destructive/60',
        className,
      )}
    >
      {loading && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  )
}

export function Modal({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string
  subtitle?: string
  onClose: () => void
  children: React.ReactNode
}) {
  const ref = useRef<HTMLButtonElement>(null)

  // Aparte del listener de Escape: `onClose` llega como una función nueva en
  // cada render del padre, y si el foco inicial dependiera de ese efecto se
  // le robaría el foco a un campo en el que el admin está escribiendo cada
  // vez que el padre se vuelve a renderizar (por ejemplo, al tipear en otro
  // formulario mientras esta modal sigue abierta).
  useEffect(() => {
    ref.current?.focus()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-background/80 p-4 backdrop-blur-sm sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="glass animate-rise glow-edge relative my-auto w-full max-w-lg rounded-3xl p-6 sm:p-8">
        <button
          ref={ref}
          type="button"
          onClick={onClose}
          aria-label="Cerrar"
          className="glass absolute top-5 right-5 flex size-9 items-center justify-center rounded-full text-muted-foreground transition-all duration-200 hover:border-primary/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:scale-95"
        >
          <X className="size-4" strokeWidth={1.5} />
        </button>
        <header className="mb-6 pr-12">
          <h2 className="text-xl font-light tracking-tight">{title}</h2>
          {subtitle && <p className="mt-1 text-sm font-light text-muted-foreground">{subtitle}</p>}
        </header>
        {children}
      </div>
    </div>
  )
}
