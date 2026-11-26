const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { test } = require('node:test')
const { readRuntimeSettings, saveRuntimeSettings, createRuntimeController } = require('../outputs/closure-companion/runtime-settings.cjs')

async function fixture(t) {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'closure-runtime-'))
  t.after(() => fs.rm(profile, { recursive: true, force: true }))
  return profile
}

test('fresh profiles default to desktop and login startup; explicit legacy linkage migrates', async (t) => {
  const profile = await fixture(t)
  assert.deepEqual(await readRuntimeSettings(profile), { codexLinked: false, dshLinked: false, workbuddyLinked: false, showOutsideCodex: true, startAtLogin: true })
  await fs.writeFile(path.join(profile, 'launch-mode.txt'), 'codex\n')
  assert.equal((await readRuntimeSettings(profile)).codexLinked, true)
  await fs.writeFile(path.join(profile, 'launch-mode.txt'), 'standalone\n')
  assert.equal((await readRuntimeSettings(profile)).codexLinked, false)
  await saveRuntimeSettings(profile, { codexLinked: true, startAtLogin: false })
  assert.deepEqual(await readRuntimeSettings(profile), { codexLinked: true, dshLinked: false, workbuddyLinked: false, showOutsideCodex: true, startAtLogin: false })
})

test('activity linkage, desktop display and startup toggle independently and survive relaunch', async (t) => {
  const profile = await fixture(t)
  const linked = []
  const displayChanges = []
  let registered = false
  const setStartup = async (enabled) => {
    if (enabled !== undefined) registered = enabled
    return registered
  }
  const runtime = await createRuntimeController({ profile, setStartup,
    onLinkedChange: async (value) => linked.push(value),
    onDisplayChange: async (value) => displayChanges.push(value),
  })
  assert.equal(registered, true)
  assert.equal((await runtime.update('startAtLogin', false)).ok, true)
  assert.equal(registered, false)
  assert.deepEqual(linked, [])
  assert.equal((await runtime.update('codexLinked', true)).ok, true)
  assert.equal(runtime.snapshot().startAtLogin, false)
  assert.equal(runtime.snapshot().showOutsideCodex, true, 'linkage does not disable desktop display')
  assert.deepEqual(linked, [true])
  assert.deepEqual(displayChanges, [])
  assert.equal((await runtime.update('showOutsideCodex', false)).ok, true)
  assert.deepEqual(displayChanges, [false])
  assert.deepEqual(linked, [true], 'display changes do not reconfigure activity linkage')
  assert.equal(runtime.snapshot().codexLinked, true)
  const restarted = await createRuntimeController({ profile, setStartup, onLinkedChange: async () => {} })
  assert.equal(registered, false, 'manual relaunch keeps startup disabled')
  assert.equal(restarted.snapshot().codexLinked, true)
  assert.equal(restarted.snapshot().showOutsideCodex, false)
  registered = true
  assert.equal((await restarted.refresh()).startAtLogin, true, 'menu reflects the actual shortcut')
})

test('failed startup updates and linkage changes roll back without a false success', async (t) => {
  const profile = await fixture(t)
  let registered = true
  let failStartup = false
  const runtime = await createRuntimeController({
    profile,
    setStartup: async (value) => {
      if (failStartup) throw new Error('Shortcut access denied')
      if (value !== undefined) registered = value
      return registered
    },
    onLinkedChange: async (enabled) => { if (enabled) throw new Error('Window reload failed') },
    onDisplayChange: async (enabled) => { if (!enabled) throw new Error('Display update failed') },
  })
  failStartup = true
  assert.equal((await runtime.update('startAtLogin', false)).ok, false)
  assert.equal(runtime.snapshot().startAtLogin, true)
  failStartup = false
  assert.equal((await runtime.update('codexLinked', true)).ok, false)
  assert.equal((await readRuntimeSettings(profile)).codexLinked, false)
  assert.equal(runtime.snapshot().codexLinked, false)
  assert.equal((await runtime.update('showOutsideCodex', false)).ok, false)
  assert.equal(runtime.snapshot().showOutsideCodex, true)
  assert.equal((await readRuntimeSettings(profile)).showOutsideCodex, true)
  // Make atomic persistence fail after a successful OS update.
  await fs.mkdir(path.join(profile, `runtime-settings.json.${process.pid}.tmp`))
  assert.equal((await runtime.update('startAtLogin', false)).ok, false)
  assert.equal(registered, true, 'OS registration is rolled back if persistence fails')
  assert.equal((await readRuntimeSettings(profile)).startAtLogin, true)
})

test('updates reject invalid values and overlapping changes', async (t) => {
  const profile = await fixture(t)
  let release
  const runtime = await createRuntimeController({
    profile, setStartup: async () => true,
    onLinkedChange: () => new Promise((resolve) => { release = resolve }),
  })
  assert.equal((await runtime.update('unknown', true)).ok, false)
  assert.equal((await runtime.update('codexLinked', 'true')).ok, false)
  const first = runtime.update('codexLinked', true)
  assert.equal((await runtime.update('startAtLogin', false)).ok, false)
  while (!release) await new Promise((resolve) => setImmediate(resolve))
  release()
  assert.equal((await first).ok, true)
})

test('DSH and WorkBuddy linkage migrate independently and roll back all integration side effects', async t => {
  const profile = await fixture(t)
  await saveRuntimeSettings(profile, { codexLinked: true, startAtLogin: false })
  let applied
  const runtime = await createRuntimeController({ profile, setStartup: async () => false,
    onIntegrationsChange: async value => { applied = value; if (value.workbuddyLinked) throw Error('Host reload failed') },
  })
  assert.equal((await runtime.update('dshLinked', true)).ok, true)
  assert.equal(applied.dshLinked, true)
  assert.equal(applied.codexLinked, true)
  assert.equal((await runtime.update('workbuddyLinked', true)).ok, false)
  const saved = await readRuntimeSettings(profile)
  assert.equal(saved.dshLinked, true)
  assert.equal(saved.workbuddyLinked, false)
  assert.equal(saved.codexLinked, true)
  assert.equal(saved.startAtLogin, false)
  assert.deepEqual(applied, saved)
})
