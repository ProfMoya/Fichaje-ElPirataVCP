'use client'

import { cn } from '@/lib/utils'

export function PinDisplay({
  value,
  length = 4,
  error = false,
}: {
  value: string
  length?: number
  error?: boolean
}) {
  return (
    <div
      className={cn(
        'glass flex h-20 w-full items-center justify-center gap-5 rounded-2xl px-6 sm:h-24 sm:gap-7',
        value.length > 0 && 'glow-edge border-primary/45',
        error && 'animate-shake border-destructive/70',
      )}
      role="status"
      aria-label={`${value.length} de ${length} dígitos introducidos`}
    >
      {Array.from({ length }).map((_, i) => {
        const filled = i < value.length
        return (
          <span
            key={i}
            className={cn(
              'rounded-full transition-all duration-300 ease-out',
              filled
                ? 'size-4 sm:size-5'
                : 'size-2.5 bg-foreground/15 sm:size-3',
              filled && !error && 'bg-primary shadow-[0_0_18px_2px_oklch(0.72_0.168_245/55%)]',
              filled && error && 'bg-destructive shadow-[0_0_18px_2px_oklch(0.62_0.2_22/55%)]',
            )}
          />
        )
      })}
    </div>
  )
}
