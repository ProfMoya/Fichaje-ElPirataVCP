'use client'

import { useEffect, useState } from 'react'

/** Ticking clock. Returns null until mounted to avoid hydration mismatches. */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState<Date | null>(null)

  useEffect(() => {
    setNow(new Date())
    const id = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])

  return now
}
