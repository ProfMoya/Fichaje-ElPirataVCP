/**
 * OBSOLETO — este archivo se puede borrar.
 *
 * Guardaba los empleados y los fichajes en memoria del navegador con datos
 * inventados. Ahora los datos viven en Supabase y se leen desde el servidor:
 * el kiosco usa `app/actions/kiosco.ts` y el panel `app/actions/admin.ts`.
 *
 * Queda solo para que el proyecto compile si algún import viejo lo referencia.
 * Una vez que confirmes que nada lo importa (`grep -r timeclock-provider .`),
 * borralo.
 */

export function useTimeclock(): never {
  throw new Error(
    'useTimeclock ya no existe. Usá las server actions de app/actions/kiosco.ts o app/actions/admin.ts.',
  )
}
