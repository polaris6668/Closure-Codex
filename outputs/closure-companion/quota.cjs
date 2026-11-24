const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { constants } = require('node:fs')
const { spawn, execFile } = require('node:child_process')
const { createInterface } = require('node:readline')
const { promisify } = require('node:util')
const { version } = require('./package.json')

const minute = 60_000
const hejuHosts = new Set(['www.hejuapi.com', 'hejuapi.com'])
const currencyUnits = new Set(Intl.supportedValuesOf('currency'))
const run = promisify(execFile)

async function findCodex() {
  if (process.platform === 'darwin') {
    const roots = ['/Applications', path.join(os.homedir(), 'Applications')]
    const names = ['ChatGPT.app', 'Codex.app']
    for (const root of roots) {
      for (const name of names) {
        const resources = path.join(root, name, 'Contents', 'Resources')
        for (const relative of ['codex-cli/CodexCLI.app/Contents/MacOS/codex', 'codex']) {
          const executable = path.join(resources, relative)
          if (await fs.access(executable, constants.X_OK).then(() => true, () => false)) return executable
        }
      }
    }
    const { stdout } = await run('/usr/bin/which', ['codex'], { timeout: 3000 })
    const executable = stdout.trim()
    await fs.access(executable, constants.X_OK)
    return executable
  }
  const powershell = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe')
  const { stdout } = await run(powershell, ['-NoProfile', '-NonInteractive', '-Command',
    "(Get-AppxPackage -Name OpenAI.Codex | Select-Object -First 1).InstallLocation"], { windowsHide: true, timeout: 8000 })
  const executable = path.join(stdout.trim(), 'app', 'resources', 'codex.exe')
  await fs.access(executable)
  return executable
}

async function withCodex(executable, home, operation) {
  const child = spawn(executable, ['app-server', '--listen', 'stdio://'], {
    env: { ...process.env, CODEX_HOME: home }, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'],
  })
  const lines = createInterface({ input: child.stdout })
  let pending
  let id = 0
  let closed = false
  function disconnect() {
    closed = true
    pending?.finish(new Error('Codex app server disconnected'))
  }
  child.on('error', disconnect)
  child.on('exit', disconnect)
  child.stdin.on('error', disconnect)
  lines.on('line', (line) => {
    let message
    try { message = JSON.parse(line) } catch { return }
    if (pending && message.id === pending.id) {
      pending.finish(message.error ? new Error('Codex account request failed') : null, message.result)
    }
  })
  function call(method, params) {
    return new Promise((resolve, reject) => {
      if (closed) { reject(new Error('Codex app server unavailable')); return }
      const requestId = ++id
      const timer = setTimeout(() => pending?.finish(new Error('Codex account request timed out')), 10000)
      pending = { id: requestId, finish(error, result) {
        clearTimeout(timer)
        pending = null
        if (error) reject(error)
        else resolve(result)
      } }
      child.stdin.write(JSON.stringify({ id: requestId, method, params }) + '\n')
    })
  }
  try {
    await call('initialize', { clientInfo: { name: 'closure_companion', version } })
    child.stdin.write('{"method":"initialized"}\n')
    return await operation(call)
  } finally {
    lines.close()
    child.stdin.end()
    child.kill()
  }
}

function providerFrom(config, env) {
  const name = config.model_provider || 'openai'
  const provider = config.model_providers?.[name] || {}
  const base = provider.base_url || (name === 'openai' ? config.openai_base_url || env.OPENAI_BASE_URL : null)
  let url
  try { if (base) url = new URL(base) } catch { return { source: 'unsupported' } }
  if (url?.protocol === 'https:' && hejuHosts.has(url.hostname) && !url.username && !url.password && !url.port) {
    const key = (provider.env_key ? env[provider.env_key] : provider.experimental_bearer_token)?.trim()
    return { source: 'thirdParty', key: /^sk-[^\s]+$/.test(key || '') ? key : undefined }
  }
  if (name !== 'openai' || (url && url.origin !== 'https://api.openai.com')) return { source: 'unsupported' }
  const chatgptBase = config.chatgpt_base_url || env.CHATGPT_BASE_URL
  if (chatgptBase && new URL(chatgptBase).origin !== 'https://chatgpt.com') return { source: 'unsupported' }
  return { source: 'official' }
}

async function readHeju(key, request) {
  const response = await request('https://www.hejuapi.com/api/usage/account', {
    headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
    redirect: 'error', signal: AbortSignal.timeout(8500),
  })
  if (response.status === 429) {
    const retry = response.headers.get('retry-after')
    const wait = /^\d+$/.test(retry || '') ? Number(retry) * 1000 : Date.parse(retry) - Date.now()
    return { retryAfter: Number.isFinite(wait) ? Math.max(3 * minute, wait) : 3 * minute }
  }
  if (!response.ok) return null
  const json = await response.json()
  const { remaining, unit } = json.data || {}
  if (json.success !== true || !Number.isFinite(remaining)) return null
  return { remaining, unit: currencyUnits.has(unit) ? unit : '' }
}

function officialQuota(result, now) {
  const limits = result.rateLimitsByLimitId?.codex || result.rateLimits
  if (!limits || (limits.limitId && limits.limitId !== 'codex')) return { quota: [], credits: null }
  const quota = [limits.primary, limits.secondary].filter((entry) => Number.isFinite(entry?.usedPercent) &&
    entry.usedPercent >= 0 && entry.usedPercent <= 100 && Number.isInteger(entry.windowDurationMins) &&
    entry.windowDurationMins > 0 && Number.isFinite(entry.resetsAt) && entry.resetsAt * 1000 > now
  ).map((entry) => ({ minutes: entry.windowDurationMins, remaining: 100 - entry.usedPercent, resetsAt: entry.resetsAt * 1000 }))
  const balance = limits.credits?.balance
  const credits = limits.credits?.unlimited === true ? { unlimited: true }
    : typeof balance === 'string' && /^\d{1,16}(\.\d{1,8})?$/.test(balance) ? { balance } : null
  return { quota, credits }
}

function createQuota({ enabled, home, locate = findCodex, connect = withCodex, request = fetch, now = Date.now }) {
  let state = { source: enabled ? 'checking' : 'disabled', quota: [], balance: null, credits: null, revision: 0 }
  let timer
  let stopped = false
  let nextHejuRead = 0
  let connectedKey
  let executable

  async function refresh() {
    const began = now()
    let source = 'checking'
    try {
      executable ||= await locate()
      const provider = await connect(executable, home, async (call) => {
        const { config } = await call('config/read', { includeLayers: false })
        const selected = providerFrom(config, process.env)
        source = selected.source
        if (source !== 'official') return selected
        const { account } = await call('account/read', { refreshToken: false })
        if (account?.type !== 'chatgpt') return { source: 'unsupported' }
        return { source, ...officialQuota(await call('account/rateLimits/read', { excludeResetCreditDetails: true }), now()) }
      })
      if (stopped) return
      if (provider.source === 'thirdParty' && provider.key) {
        if (connectedKey !== provider.key) { nextHejuRead = 0; connectedKey = provider.key }
        if (now() < nextHejuRead) return
        const balance = await readHeju(provider.key, request)
        if (stopped) return
        if (balance?.retryAfter) nextHejuRead = now() + balance.retryAfter
        state = { source, quota: [], balance: Number.isFinite(balance?.remaining) ? balance : null, credits: null, revision: state.revision + 1 }
      } else {
        connectedKey = undefined
        nextHejuRead = 0
        state = { source: provider.source, quota: provider.quota || [], balance: null, credits: provider.credits ?? null, revision: state.revision + 1 }
      }
    } catch {
      if (!stopped) state = { source, quota: [], balance: null, credits: null, revision: state.revision + 1 }
    } finally {
      if (enabled && !stopped) {
        timer = setTimeout(refresh, Math.max(1000, minute - (now() - began)))
        timer.unref()
      }
    }
  }

  return {
    ready: enabled ? refresh() : Promise.resolve(),
    snapshot() { return { ...state, quota: state.quota.filter((entry) => entry.resetsAt > now()) } },
    stop() { stopped = true; clearTimeout(timer); connectedKey = undefined },
  }
}

module.exports = { createQuota, withCodex }
