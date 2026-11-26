const fs = require('node:fs/promises')
const path = require('node:path')
const { fileURLToPath } = require('node:url')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { createLinkedState } = require('./linked-state.cjs')
const { connect, evaluate } = require('./local-cdp.cjs')
const runFile = promisify(execFile)
const readJson = file => fs.readFile(file, 'utf8').then(JSON.parse).catch(() => null)
const equalPath = (a, b) => typeof a === 'string' && typeof b === 'string' && path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()

async function runtimeAssetFor(executable) {
  // Electron's patched fs treats .asar as a directory; read the archive itself
  // with its built-in original-fs when running in the bundled desktop runtime.
  const archiveFs = process.versions.electron ? require('original-fs').promises : fs
  const handle = await archiveFs.open(path.join(path.dirname(executable), 'resources/app.asar'), 'r')
  try {
    const prefix = Buffer.alloc(16)
    await handle.read(prefix, 0, 16, 0)
    const size = prefix.readUInt32LE(12)
    if (size <= 0 || size > 16 * 1024 * 1024) throw Error('Unsupported WorkBuddy archive')
    const bytes = Buffer.alloc(size)
    await handle.read(bytes, 0, size, 16)
    const assets = JSON.parse(bytes.toString('utf8')).files?.renderer?.files?.assets?.files
    const matches = []
    for (const name of Object.keys(assets || {}).filter(name => /^runtime-[\w-]+\.js$/.test(name))) {
      const file = assets[name]
      if (file.unpacked || file.size > 2 * 1024 * 1024) continue
      const source = Buffer.alloc(file.size)
      await handle.read(source, 0, source.length, 8 + prefix.readUInt32LE(4) + Number(file.offset))
      if (source.includes('authGetAccountUsage') && source.includes('getDaemonClient')) matches.push(name)
    }
    if (matches.length !== 1) throw Error('Unsupported WorkBuddy runtime module')
    return matches[0]
  } finally { await handle.close() }
}

async function powershellJson(source, env = {}) {
  const script = `$ErrorActionPreference='Stop'; $result=& { ${source} }; $json=ConvertTo-Json -InputObject $result -Depth 5 -Compress; [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))`
  const { stdout } = await runFile('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
    windowsHide: true, timeout: 15000, env: { ...process.env, ...env },
  })
  return JSON.parse(Buffer.from(stdout.trim(), 'base64').toString('utf8'))
}
async function verifyOwner(port, executable) {
  const result = await powershellJson(`@(Get-NetTCPConnection -State Listen -LocalPort $env:CLOSURE_WB_PORT -ErrorAction Stop | ForEach-Object {
    $p=Get-CimInstance Win32_Process -Filter ('ProcessId=' + $_.OwningProcess)
    [pscustomobject]@{address=$_.LocalAddress;executable=$p.ExecutablePath}
  })`, { CLOSURE_WB_PORT: String(port) })
  const owners = [result].flat().filter(Boolean)
  if (!owners.length || owners.some(p => !['127.0.0.1', '::1'].includes(p.address) || !equalPath(p.executable, executable))) throw Error('WorkBuddy local connection owner mismatch')
}
async function discover({ local = process.env.LOCALAPPDATA, executable = process.env.CLOSURE_WORKBUDDY_EXE || path.join(local, 'Programs/WorkBuddy/WorkBuddy.exe') } = {}) {
  const records = await Promise.all([
    path.join(local, 'ClosureCompanion/workbuddy-session.json'), path.join(local, 'ClosureWorkBuddyTheme/session.json'),
  ].map(readJson))
  for (const record of records) {
    if (!record || !equalPath(record.executable, executable) || !Number.isInteger(record.port) || record.port < 1024 || record.port > 65535) continue
    try {
      await verifyOwner(record.port, executable)
      const list = await fetch(`http://127.0.0.1:${record.port}/json/list`, { signal: AbortSignal.timeout(2500) }).then(r => r.json())
      const renderer = path.join(path.dirname(executable), 'resources/app.asar/renderer/index.html')
      const target = list.find(t => {
        if (t.type !== 'page') return false
        try { return equalPath(fileURLToPath(new URL(t.url)), renderer) && !new URL(t.url).searchParams.has('windowAppId') }
        catch { return false }
      })
      if (target) return { port: record.port, url: target.webSocketDebuggerUrl, runtimeAsset: await runtimeAssetFor(executable) }
    } catch { /* Try another app-owned bridge record. */ }
  }
  return null
}

function creditsFromUsage(value) {
  if (value == null) return { status: 'signed-out', credits: null }
  const balance = value.usageLeft
  if (balance === 'unlimited' || balance === 'Unlimited' || balance === '不限量') return { status: 'ready', credits: { unlimited: true } }
  if (!['number', 'string'].includes(typeof balance) || !/^-?\d+(?:\.\d+)?$/.test(String(balance)) || !Number.isFinite(Number(balance))) return { status: 'unavailable', credits: null }
  return { status: 'ready', credits: { balance: String(balance) } }
}

function createWorkBuddy({ locate = discover, now = Date.now } = {}) {
  let store = createLinkedState({ now })
  let client, stopped = false, timer, instance, cursor = 0, status = 'connecting', lastBalance = 0, balanceBusy = false
  let balance = { status: 'checking', credits: null }
  let runtimeAsset, accountRevision
  const payload = fs.readFile(path.join(__dirname, 'workbuddy-renderer.js'), 'utf8')
  async function refreshBalance() {
    if (balanceBusy || !client || client.closed) return
    balanceBusy = true; lastBalance = now()
    const current = client
    const identity = accountRevision
    try {
      if (!/^runtime-[\w-]+\.js$/.test(runtimeAsset || '')) throw Error('WorkBuddy account API not loaded')
      const value = await evaluate(current, `(async()=>{const m=await import('./assets/${runtimeAsset}');const v=await m.n().authGetAccountUsage({locale:'zh'});return v?{usageLeft:v.usageLeft}:null})()`)
      if (!stopped && client === current && identity === accountRevision) balance = creditsFromUsage(value)
    } catch { if (!stopped && client === current && identity === accountRevision) balance = { status: 'unavailable', credits: null } }
    finally { balanceBusy = false }
  }
  async function tick() {
    try {
      if (!client || client.closed) {
        client = null; runtimeAsset = undefined
        const endpoint = await locate()
        if (stopped) return
        if (!endpoint) { status = 'waiting'; balance = { status: 'disconnected', credits: null }; return }
        client = await connect(endpoint.url, endpoint.port)
        runtimeAsset = endpoint.runtimeAsset
        if (stopped) { client.close(); return }
        balance = { status: 'checking', credits: null }
        lastBalance = 0
      }
      if (!await evaluate(client, await payload)) { status = 'connecting'; return }
      const snapshot = await evaluate(client, 'window.__closureCompanionBridge.snapshot()')
      if (snapshot.accountRevision !== accountRevision) {
        accountRevision = snapshot.accountRevision
        lastBalance = 0; balance = { status: 'checking', credits: null }
      }
      if (snapshot.instance !== instance) {
        store = createLinkedState({ now })
        instance = snapshot.instance; cursor = snapshot.sequence
        for (const session of snapshot.sessions) store.seed(session.id, ['planning', 'working', 'pending'].includes(session.state), session.lastActivityAt)
      } else {
        for (const event of snapshot.events) if (event.seq > cursor) {
          store.event(event.id, event.kind, event.data, event.at)
          if (event.kind === 'end') lastBalance = 0
        }
        cursor = snapshot.sequence
      }
      status = 'connected'
      if (now() - lastBalance >= 60000) void refreshBalance()
    } catch {
      status = 'disconnected'; balance = { status: 'disconnected', credits: null }
      client?.close(); client = null
    } finally {
      if (!stopped) { timer = setTimeout(tick, client && !client.closed ? 1000 : 5000); timer.unref?.() }
    }
  }
  const ready = tick()
  return { ready, snapshot() {
    const state = store.snapshot()
    if (status !== 'connected') state.work = { active: false, mode: 'idle' }
    return { ...state, instance, connected: status === 'connected', status,
      closureCompanion: { ...state.closureCompanion, source: 'official', host: 'workbuddy', accountStatus: balance.status, credits: balance.credits } }
  }, stop() {
    stopped = true; clearTimeout(timer)
    const current = client; client = null
    if (current && !current.closed) {
      evaluate(current, 'window.__closureCompanionBridge?.dispose()').catch(() => {}).finally(() => current.close())
    }
  } }
}
module.exports = { createWorkBuddy, creditsFromUsage, discover, verifyOwner, powershellJson, equalPath }
