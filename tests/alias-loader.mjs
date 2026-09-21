/**
 * Resuelve el alias `@/` fuera de Next.
 *
 * Los tests corren con el intérprete de Node pelado (`node --experimental-strip-types`),
 * que no sabe nada del `paths` de tsconfig.json. Este hook traduce
 * `@/lib/tz` a la ruta real del archivo para que el código de la app se pueda
 * importar tal cual está, sin una copia paralela solo para testear.
 *
 * También reemplaza, solo en los tests, lo que necesita un servidor real: la
 * base de datos (`@/lib/repo`), los headers de Next (`@/lib/request-ip`) y el
 * guard `server-only`. Así las server actions se ejecutan de punta a punta
 * contra un repositorio en memoria.
 */
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const reemplazos = new Map([
  ['@/lib/repo', 'tests/fakes/repo.ts'],
  ['@/lib/request-ip', 'tests/fakes/request-ip.ts'],
  ['server-only', 'tests/stubs/server-only.mjs'],
])

export function resolve(specifier, context, next) {
  const reemplazo = reemplazos.get(specifier)
  if (reemplazo) return next(pathToFileURL(path.join(root, reemplazo)).href, context)

  if (specifier.startsWith('@/')) {
    const base = path.join(root, specifier.slice(2))
    return next(pathToFileURL(`${base}.ts`).href, context)
  }
  return next(specifier, context)
}
