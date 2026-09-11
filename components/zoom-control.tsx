'use client'

import { Minus, Plus, ZoomIn } from 'lucide-react'
import { useEffect, useState } from 'react'

const STORAGE_KEY = 'fichaje-zoom'
const MIN = 70
const MAX = 150
const STEP = 10
const DEFAULT = 100

function readStored(): number {
  const raw = window.localStorage.getItem(STORAGE_KEY)
  const n = raw ? Number(raw) : DEFAULT
  return Number.isFinite(n) && n >= MIN && n <= MAX ? n : DEFAULT
}

/**
 * Ajuste de zoom de toda la pantalla. Pensado para calibrar una terminal una
 * sola vez frente a una resolución que no se conoce de antemano — se guarda
 * en localStorage, así que queda propio de ese navegador (esa PC) y no
 * afecta a nadie que abra la app desde otro lado.
 */
export function ZoomControl() {
  const [zoom, setZoom] = useState(DEFAULT)

  useEffect(() => {
    setZoom(readStored())
  }, [])

  useEffect(() => {
    document.documentElement.style.zoom = `${zoom}%`
    window.localStorage.setItem(STORAGE_KEY, String(zoom))
  }, [zoom])

  return (
    <div className="glass fixed right-4 bottom-4 z-50 flex items-center gap-1 rounded-full px-2 py-2">
      <ZoomIn className="ml-1 size-4 text-primary" strokeWidth={1.8} />
      <button
        type="button"
        onClick={() => setZoom((z) => Math.max(MIN, z - STEP))}
        disabled={zoom <= MIN}
        className="flex size-9 items-center justify-center rounded-full text-foreground transition-colors hover:bg-white/10 disabled:opacity-30"
        aria-label="Reducir zoom"
      >
        <Minus className="size-4" strokeWidth={2} />
      </button>
      <button
        type="button"
        onClick={() => setZoom(DEFAULT)}
        className="min-w-12 px-1 text-center text-sm font-medium tabular-nums text-foreground hover:text-primary"
        aria-label="Restablecer zoom al 100%"
      >
        {zoom}%
      </button>
      <button
        type="button"
        onClick={() => setZoom((z) => Math.min(MAX, z + STEP))}
        disabled={zoom >= MAX}
        className="flex size-9 items-center justify-center rounded-full text-foreground transition-colors hover:bg-white/10 disabled:opacity-30"
        aria-label="Aumentar zoom"
      >
        <Plus className="size-4" strokeWidth={2} />
      </button>
    </div>
  )
}
