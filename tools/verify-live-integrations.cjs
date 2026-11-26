// Read-only account/status checks against already-running applications.
// Does not attach activity observers, submit prompts, change settings or restart apps.
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')
const { version } = require('../outputs/closure-companion/package.json')
const { createQuota } = require('../outputs/closure-companion/quota.cjs')
const { discover, creditsFromUsage } = require('../outputs/closure-companion/workbuddy.cjs')
const { connect, evaluate } = require('../outputs/closure-companion/local-cdp.cjs')

async function main() {
  const root = path.resolve(__dirname, '..')
  const output = path.join(root, 'work', `release-${version}`, 'live-integrations.json')
  const quota = createQuota({ enabled: true, home: process.env.CODEX_HOME || path.join(os.homedir(), '.codex') })
  const checks = {}
  try {
    await quota.ready
    const value = quota.snapshot()
    assert.ok(value.quota.length || value.credits || value.balance, 'Codex account query returned no usable quota or balance')
    checks.codex = { passed: true, source: value.source, accountReadable: true }
  } finally { quota.stop() }
  const dsh = await fs.readFile(path.join(process.env.LOCALAPPDATA, 'ClosureCompanion/bridges/dsh.json'), 'utf8').then(JSON.parse).catch(error => {
    if (error.code !== 'ENOENT') throw error
    return null
  })
  if (dsh && Date.now() - dsh.updatedAt < 15000) {
    assert.ok(['ready','signed-out'].includes(dsh.balance.status))
    assert.ok(Array.isArray(dsh.state.conversations), 'DSH bridge must expose the current per-conversation protocol')
    checks.dsh = { passed: true, connected: true, officialAccountStatus: dsh.balance.status, perConversationProtocol: true }
  } else checks.dsh = { connected: false, liveAccountCheck: 'not run; no active bridge' }
  const endpoint = await discover()
  if (endpoint) {
    const client = await connect(endpoint.url, endpoint.port)
    try {
      const result = await evaluate(client, `(async()=>{const m=await import('./assets/${endpoint.runtimeAsset}');const v=await m.n().authGetAccountUsage({locale:'zh'});return {usage:v?{usageLeft:v.usageLeft}:null,observerVersion:window.__closureCompanionBridge?.version}})()`)
      assert.ok(['ready','signed-out'].includes(creditsFromUsage(result.usage).status))
      assert.equal(result.observerVersion, 2)
      checks.workbuddy = { passed: true, connected: true, officialAccountReadable: true, observerVersion: result.observerVersion, verifiedLoopbackOwner: true }
    } finally { client.close() }
  } else checks.workbuddy = { connected: false, liveAccountCheck: 'not run; no active bridge' }
  await fs.mkdir(path.dirname(output), { recursive: true })
  const report = { passed: true, scope: 'Read-only checks on current logged-in local applications; no prompts submitted', checks }
  await fs.writeFile(output, JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
