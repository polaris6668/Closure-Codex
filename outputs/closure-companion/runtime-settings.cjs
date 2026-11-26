const { mkdir, readFile, rename, writeFile } = require('node:fs/promises')
const path = require('node:path')

async function readRuntimeSettings(profile, defaults = { codexLinked: false, startAtLogin: true }) {
  try {
    const value = JSON.parse(await readFile(path.join(profile, 'runtime-settings.json'), 'utf8'))
    if (typeof value.codexLinked !== 'boolean' || typeof value.startAtLogin !== 'boolean' ||
        ['dshLinked', 'workbuddyLinked', 'showOutsideCodex'].some(key => value[key] !== undefined && typeof value[key] !== 'boolean')) {
      throw new Error('Invalid companion runtime settings')
    }
    return { codexLinked: value.codexLinked, dshLinked: value.dshLinked ?? false, workbuddyLinked: value.workbuddyLinked ?? false,
      showOutsideCodex: value.showOutsideCodex ?? true, startAtLogin: value.startAtLogin }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  // Keep an explicitly saved choice from releases that offered two modes.
  let codexLinked = defaults.codexLinked
  try {
    codexLinked = (await readFile(path.join(profile, 'launch-mode.txt'), 'utf8')).trim() === 'codex'
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  return { codexLinked, dshLinked: false, workbuddyLinked: false, showOutsideCodex: true, startAtLogin: defaults.startAtLogin }
}

async function saveRuntimeSettings(profile, settings) {
  await mkdir(profile, { recursive: true })
  const target = path.join(profile, 'runtime-settings.json')
  const temporary = `${target}.${process.pid}.tmp`
  await writeFile(temporary, JSON.stringify(settings) + '\n', 'utf8')
  await rename(temporary, target)
}

async function createRuntimeController({ profile, defaults, setStartup, onLinkedChange = async () => {}, onIntegrationsChange = async () => {}, onDisplayChange = async () => {} }) {
  let settings = await readRuntimeSettings(profile, defaults)
  let startAtLogin = settings.startAtLogin
  let startupError = ''
  let busy = false
  let revision = 0
  await saveRuntimeSettings(profile, settings)
  try {
    await setStartup(settings.startAtLogin)
  } catch {
    startupError = '开机自启设置未生效，请在菜单中重试。'
  }
  const snapshot = () => ({ ...settings, startAtLogin, startupError })
  async function refresh() {
    if (busy) return snapshot()
    const before = revision
    try {
      const registered = await setStartup()
      if (before === revision && !busy) {
        startAtLogin = registered
        if (startAtLogin === settings.startAtLogin) startupError = ''
      }
    } catch {
      if (before === revision && !busy) startupError = '开机自启状态未读取，请重试。'
    }
    return snapshot()
  }
  async function update(key, enabled) {
    if (!['codexLinked', 'dshLinked', 'workbuddyLinked', 'showOutsideCodex', 'startAtLogin'].includes(key) || typeof enabled !== 'boolean' || busy) {
      return { ok: false, error: '设置正在更新，请稍后重试。' }
    }
    busy = true
    revision++
    const previous = settings
    const previousStartup = startAtLogin
    const next = { ...settings, [key]: enabled }
    let startupChanged = false
    let saved = false
    try {
      if (key === 'startAtLogin') {
        await setStartup(enabled)
        startupChanged = true
      }
      await saveRuntimeSettings(profile, next)
      saved = true
      if (key === 'codexLinked' && enabled !== previous.codexLinked) await onLinkedChange(enabled)
      if (['codexLinked', 'dshLinked', 'workbuddyLinked'].includes(key) && enabled !== previous[key]) await onIntegrationsChange(next)
      if (key === 'showOutsideCodex' && enabled !== previous.showOutsideCodex) await onDisplayChange(enabled)
      settings = next
      if (key === 'startAtLogin') { startAtLogin = enabled; startupError = '' }
      return { ok: true, ...snapshot() }
    } catch (error) {
      console.error('Closure runtime settings:', error.message)
      if (saved) {
        await saveRuntimeSettings(profile, previous).catch((rollback) => console.error('Closure settings rollback:', rollback.message))
        if (key === 'codexLinked') await onLinkedChange(previous.codexLinked).catch((rollback) => console.error('Closure linkage rollback:', rollback.message))
        if (['codexLinked', 'dshLinked', 'workbuddyLinked'].includes(key)) await onIntegrationsChange(previous).catch((rollback) => console.error('Closure integration rollback:', rollback.message))
        if (key === 'showOutsideCodex') await onDisplayChange(previous.showOutsideCodex).catch((rollback) => console.error('Closure display rollback:', rollback.message))
      }
      if (startupChanged) {
        await setStartup(previousStartup).catch((rollback) => console.error('Closure startup rollback:', rollback.message))
      }
      const label = { startAtLogin: '开机自启', codexLinked: 'Codex 联动', dshLinked: 'DSH 联动', workbuddyLinked: 'WorkBuddy 联动', showOutsideCodex: '显示范围' }[key]
      return { ok: false, error: `${label}设置未保存，请重试。` }
    } finally {
      busy = false
    }
  }
  return { snapshot, refresh, update }
}

module.exports = { readRuntimeSettings, saveRuntimeSettings, createRuntimeController }
