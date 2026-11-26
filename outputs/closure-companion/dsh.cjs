const fs = require('node:fs/promises')
const path = require('node:path')

function wallets(value) {
  if (!Array.isArray(value)) return []
  return value.filter(v => ['CNY', 'USD'].includes(v?.currency) &&
    typeof v.balance === 'string' && /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?$/.test(v.balance) && Number.isFinite(Number(v.balance)))
    .map(v => ({ currency: v.currency, balance: v.balance }))
}
function createDsh({ directory, now = Date.now } = {}) {
  let state, stopped = false, timer
  const request = path.join(directory, 'dsh-request.json')
  const target = path.join(directory, 'dsh.json')
  async function tick() {
    try {
      await fs.mkdir(directory, { recursive: true })
      if (stopped) return
      await fs.writeFile(request, JSON.stringify({ enabled: true, updatedAt: now() }), { mode: 0o600 })
      const info = await fs.stat(target)
      if (info.size > 1024 * 1024) throw Error('Oversized DSH bridge snapshot')
      const value = JSON.parse(await fs.readFile(target, 'utf8'))
      if (value.version !== 1 || value.host !== 'dsh' || typeof value.instance !== 'string' ||
          !Number.isFinite(value.updatedAt) || value.updatedAt > now() + 5000 || now() - value.updatedAt > 15000 ||
          !value.state?.tools || !value.state?.turnEnd) throw Error('Stale or incompatible DSH bridge')
      if (!stopped) state = value
    } catch { state = undefined }
    finally { if (!stopped) { timer = setTimeout(tick, 1000); timer.unref?.() } }
  }
  const ready = tick()
  return { ready, snapshot() {
    const value = state && now() - state.updatedAt < 15000 ? state : null
    const balance = value?.balance
    return { ...(value?.state || {}), connected: Boolean(value), instance: value?.instance,
      status: value ? 'connected' : 'waiting',
      closureCompanion: { ...value?.state?.closureCompanion, quota: [], source: 'official', host: 'dsh',
        accountStatus: value ? balance?.status || 'unavailable' : 'disconnected',
        wallets: balance?.status === 'ready' ? wallets(balance.wallets) : [],
        bonusWallets: balance?.status === 'ready' ? wallets(balance.bonusWallets) : [] } }
  }, stop() {
    stopped = true; clearTimeout(timer)
    // The host lease also expires if the pet exits unexpectedly.
    void fs.writeFile(request, JSON.stringify({ enabled: false, updatedAt: now() }), { mode: 0o600 }).catch(() => {})
  } }
}
module.exports = { createDsh, wallets }
