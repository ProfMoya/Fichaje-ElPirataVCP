import assert from 'node:assert/strict'
import { registrarFichaje } from '@/app/actions/kiosco'
import * as repo from '@/tests/fakes/repo'
import { addDaysToKey, zonedNow } from '@/lib/tz'

/**
 * Flujo del kiosco de punta a punta (server action + reglas de horario) contra
 * un repositorio en memoria. Ninguno de estos casos depende de la hora del día
 * en que se corren los tests.
 */

let n = 0
const t = async (nombre: string, fn: () => Promise<void>) => {
  repo.reset()
  repo.addEmployee({ id: 'timo', name: 'Timoteo Gonzalez', pin: '1111' })
  repo.addEmployee({ id: 'baja', name: 'Ex Empleado', pin: '2222', active: false })
  await fn()
  n++
  console.log('  ok ·', nombre)
}

async function main() {
  const hoy = zonedNow().dayKey
  const ayer = addDaysToKey(hoy, -1)
  const hace3 = addDaysToKey(hoy, -3)

  console.log('\nFICHAJE EN EL KIOSCO (flujo completo)')

  await t('primer toque del día abre la entrada', async () => {
    const r = await registrarFichaje('1111')
    assert.ok(r.ok)
    assert.equal(r.kind, 'in')
    assert.equal(r.turno, 1)
    assert.deepEqual(r.olvidados, [])
    assert.equal(repo.allPunches().length, 1)
  })

  await t('quien dejó un fichaje sin salida hace días puede volver a fichar (caso Timoteo)', async () => {
    repo.addPunch({ employeeId: 'timo', day: hace3, in: 615, out: null })

    const r = await registrarFichaje('1111')

    assert.ok(r.ok, 'no debería fallar: el olvido viejo no puede bloquear la entrada de hoy')
    assert.equal(r.kind, 'in')
    assert.deepEqual(r.olvidados, [hace3], 'y tiene que avisarle del día que se le olvidó')
    const abiertos = repo.allPunches().filter((p) => p.out === null)
    assert.equal(abiertos.length, 2) // el viejo sigue esperando al admin + el de hoy
  })

  await t('un turno que pasó la medianoche y supera el tope no se cierra con 24 horas', async () => {
    // Entró ayer a las 00:00: cualquiera sea la hora de hoy, cerrarlo serían más de 24 horas.
    repo.addPunch({ employeeId: 'timo', day: ayer, in: 0, out: null })

    const r = await registrarFichaje('1111')

    assert.ok(r.ok)
    assert.equal(r.kind, 'in', 'abre uno nuevo en vez de cerrar el de ayer')
    assert.deepEqual(r.olvidados, [ayer])
    assert.equal(repo.allPunches().find((p) => p.day === ayer)?.out, null, 'el de ayer no se toca')
  })

  await t('dos toques simultáneos del mismo PIN no dejan dos entradas abiertas', async () => {
    const [a, b] = await Promise.all([registrarFichaje('1111'), registrarFichaje('1111')])

    assert.equal([a, b].filter((r) => r.ok).length, 1, 'uno registra la entrada')
    const fallido = [a, b].find((r) => !r.ok)
    assert.ok(fallido && !fallido.ok)
    assert.equal(fallido.code, 'servidor')
    assert.match(fallido.message, /fichaje abierto/, 'el mensaje tiene que explicar qué pasó, no ser genérico')
    assert.equal(repo.allPunches().filter((p) => p.out === null).length, 1)
  })

  await t('si falla la lectura de olvidados, el fichaje igual queda registrado', async () => {
    repo.control.fallarLecturaDeOlvidados = true
    const consoleError = console.error
    console.error = () => {}
    try {
      const r = await registrarFichaje('1111')
      assert.ok(r.ok)
      assert.deepEqual(r.olvidados, [])
      assert.equal(repo.allPunches().length, 1)
    } finally {
      console.error = consoleError
    }
  })

  await t('un legajo dado de baja no ficha', async () => {
    const r = await registrarFichaje('2222')
    assert.ok(!r.ok)
    assert.equal(r.code, 'inactivo')
    assert.equal(repo.allPunches().length, 0)
  })

  await t('PIN mal formado se rechaza sin tocar la base', async () => {
    const r = await registrarFichaje('12')
    assert.ok(!r.ok)
    assert.equal(r.code, 'formato')
  })

  await t('tras 15 PIN desconocidos seguidos desde la misma IP, frena', async () => {
    for (let i = 0; i < 15; i++) {
      const r = await registrarFichaje('9999')
      assert.ok(!r.ok)
      assert.equal(r.code, 'desconocido')
    }
    const r = await registrarFichaje('9999')
    assert.ok(!r.ok)
    assert.equal(r.code, 'saturado')
  })

  console.log(`\n${n} verificaciones del kiosco pasaron\n`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
