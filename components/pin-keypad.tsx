'use client'

import { useEffect } from 'react'
import { Check, Delete } from 'lucide-react'
import { cn } from '@/lib/utils'

type Props = {
  value: string
  onChange: (next: string) => void
  onSubmit: () => void
  maxLength?: number
  disabled?: boolean
}

export function PinKeypad({ value, onChange, onSubmit, maxLength = 4, disabled = false }: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (disabled) return
      if (/^[0-9]$/.test(e.key)) {
        if (value.length < maxLength) onChange(value + e.key)
      } else if (e.key === 'Backspace') {
        onChange(value.slice(0, -1))
      } else if (e.key === 'Enter') {
        onSubmit()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [value, maxLength, onChange, onSubmit, disabled])

  const press = (digit: string) => {
    if (disabled || value.length >= maxLength) return
    onChange(value + digit)
  }

  return (
    <div className="grid w-full grid-cols-3 gap-3 sm:gap-4">
      {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
        <Key key={d} onClick={() => press(d)} disabled={disabled} label={`Número ${d}`}>
          <span className="tnum font-mono text-3xl font-medium sm:text-4xl">{d}</span>
        </Key>
      ))}

      <Key
        onClick={() => !disabled && onChange(value.slice(0, -1))}
        disabled={disabled}
        label="Borrar"
        variant="muted"
      >
        <Delete className="size-7 sm:size-8" strokeWidth={1.5} />
      </Key>

      <Key onClick={() => press('0')} disabled={disabled} label="Número 0">
        <span className="tnum font-mono text-3xl font-medium sm:text-4xl">0</span>
      </Key>

      <Key
        onClick={onSubmit}
        disabled={disabled || value.length === 0}
        label="Confirmar fichaje"
        variant="primary"
      >
        <Check className="size-7 sm:size-8" strokeWidth={2} />
      </Key>
    </div>
  )
}

function Key({
  children,
  onClick,
  disabled,
  label,
  variant = 'default',
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  label: string
  variant?: 'default' | 'muted' | 'primary'
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={cn(
        'glass group relative flex h-16 items-center justify-center rounded-xl select-none sm:h-20',
        'transition-[transform,box-shadow,background-color,border-color] duration-200 ease-out',
        'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        'active:scale-[0.96] active:duration-75',
        'disabled:pointer-events-none disabled:opacity-40',
        variant === 'default' && 'text-foreground hover:border-primary/50 hover:glow-edge',
        variant === 'muted' && 'text-muted-foreground hover:border-primary/40 hover:text-foreground',
        variant === 'primary' &&
          'border-primary/60 text-primary glow-edge hover:border-primary hover:glow-edge-strong',
      )}
    >
      {children}
    </button>
  )
}
