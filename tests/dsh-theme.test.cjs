const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const root = path.resolve(__dirname, '../plugins/dsh-closure-codex-theme')

function load() {
  let plugin
  vm.runInNewContext(fs.readFileSync(path.join(root, 'lib/client.js'), 'utf8'), {
    window: { __ModuleLoader__: { load({ id, factory }) {
      assert.equal(id, 'dsh-closure-codex-theme')
      plugin = factory()
    } } }, queueMicrotask,
  })
  return plugin
}

function themeHost() {
  const themes = new Map([['system', {}], ['dark', {}], ['light', {}]])
  const listeners = new Set()
  const effects = []
  let preference = 'light'
  const snapshot = () => ({ preference, active: themes.get(preference), themes: [...themes].map(([id, value]) => ({ id, ...value })) })
  const publish = () => { for (const listener of listeners) listener(snapshot()) }
  const ctx = {
    theme: {
      getTheme: snapshot,
      setTheme(id) { assert.ok(themes.has(id)); preference = id; publish() },
      register(definition) {
        assert.ok(!themes.has(definition.id)); themes.set(definition.id, definition); publish()
        return () => { themes.delete(definition.id); publish() }
      },
    },
    on(name, fn) { assert.equal(name, 'theme/change'); listeners.add(fn); return () => listeners.delete(fn) },
    effect(fn) { effects.push(fn()) },
    dispose() { effects.reverse().forEach(fn => fn()) },
    themes, listeners,
  }
  return ctx
}

test('the DSH bundle uses the Codex palette and releases its theme on unload', () => {
  const ctx = themeHost()
  load().apply(ctx)
  assert.equal(ctx.theme.getTheme().preference, 'dsh-closure-codex-theme')
  const active = ctx.theme.getTheme().active
  const codex = JSON.parse(fs.readFileSync(path.resolve(root, '../../outputs/closure-theme/closure-dark.txt'), 'utf8').slice('codex-theme-v1:'.length)).theme
  assert.equal(active.colorScheme, 'dark')
  assert.equal(active.tokens['--dsw-alias-bg-base'], codex.surface)
  assert.equal(active.tokens['--dsw-alias-label-primary'], codex.ink)
  assert.equal(active.tokens['--dsw-alias-link'], codex.accent)
  assert.equal(active.tokens['--dsw-alias-file-diff-added-marker'], codex.semanticColors.diffAdded)
  ctx.dispose()
  assert.equal(ctx.theme.getTheme().preference, 'light')
  assert.equal(ctx.themes.size, 3)
  assert.equal(ctx.listeners.size, 0)
})

test('late host preference hydration cannot drop the theme, and the latest preference is restored', async () => {
  const ctx = themeHost()
  load().apply(ctx)
  ctx.theme.setTheme('system')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(ctx.theme.getTheme().preference, 'dsh-closure-codex-theme')
  ctx.dispose()
  assert.equal(ctx.theme.getTheme().preference, 'system')
})

test('unloading during a pending reapply never reactivates the disposed plugin', async () => {
  const ctx = themeHost()
  load().apply(ctx)
  ctx.theme.setTheme('dark')
  ctx.dispose()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(ctx.theme.getTheme().preference, 'dark')
  assert.equal(ctx.themes.has('dsh-closure-codex-theme'), false)
})
