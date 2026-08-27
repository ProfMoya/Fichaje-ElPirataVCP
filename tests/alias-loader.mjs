/**
 * Resuelve el alias `@/` fuera de Next.
 *
 * Los tests corren con el intérprete de Node pelado (`node --experimental-strip-types`),
 * que no sabe nada del `paths` de tsconfig.json. Este hook traduce
 * `@/lib/tz` a la ruta real del archivo para que el código de la app se pueda
 * importar tal cual está, sin una copia paralela solo para testear.
 */
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export function resolve(specifier, context, next) {
  if (specifier.startsWith('@/')) {
    const base = path.join(root, specifier.slice(2))
    return next(pathToFileURL(`${base}.ts`).href, context)
  }
  return next(specifier, context)
}
