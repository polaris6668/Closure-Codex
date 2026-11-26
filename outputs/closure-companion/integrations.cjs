const path = require('node:path')
const os = require('node:os')
const { createActivity } = require('./activity.cjs')
const { createQuota } = require('./quota.cjs')
const { createDsh } = require('./dsh.cjs')

const keys = { codex: 'codexLinked', dsh: 'dshLinked', workbuddy: 'workbuddyLinked' }
const names = { codex: 'Codex', dsh: 'DSH', workbuddy: 'WorkBuddy' }
const counters = s => [s?.turnStartSeq || 0, s?.turnEnd?.seq || 0, s?.tools?.ok || 0, s?.tools?.fail || 0, s?.errors?.count || 0, s?.userInput?.seq || 0]

function createIntegrations({ codexHome, enabled = true, macMode = false, now = Date.now,
  directory = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.local/share'), 'ClosureCompanion/bridges'), factories = {} } = {}) {
  const hosts = new Map(), totals = [0, 0, 0, 0, 0, 0]
  const turnEnds = [], desktopEvents = []
  let desktopEventSeq = 0
  let focusKey = null, focusRevision = 0
  let latestEnd = { kind: 'completed' }, latestTools = {}, latestError = {}, latestInput = { scene: null }
  const create = {
    codex() {
      if (macMode) {
        const activity = createActivity(true, path.join(codexHome, 'sessions'), { desktopOnly: true })
        const quota = createQuota({ enabled: true, home: codexHome })
        return { snapshot() {
          const value = activity.snapshot()
          const limits = quota.snapshot()
          if (!limits.quota.length && ['official', 'checking'].includes(limits.source)) {
            limits.quota = value.closureCompanion.quota
          }
          const { following } = value.closureCompanion
          // Keep the macOS Codex queue intact when multiple turns end between two polls.
          return { ...value, conversations: undefined, connected: following,
            status: following ? 'connected' : 'waiting', instance: 'codex',
            closureCompanion: { ...value.closureCompanion, ...limits, host: 'codex' } }
        }, stop() { activity.stop(); quota.stop() } }
      }
      const { powershellJson } = require('./workbuddy.cjs')
      const activity = createActivity(true, path.join(codexHome, 'sessions'))
      let quota, open = false, stopped = false, timer
      async function checkConnection() {
        try {
          const running = await powershellJson(`@(Get-CimInstance Win32_Process -Filter "Name='Codex.exe' OR Name='ChatGPT.exe'" | Where-Object {
            $_.ExecutablePath -match '\\\\WindowsApps\\\\OpenAI\\.Codex_[^\\\\]+\\\\app\\\\(?:ChatGPT|Codex)\\.exe$' -and $_.CommandLine -notmatch '\\s--type='
          }).Count -gt 0`)
          if (stopped) return
          open = running === true
          if (open && !quota) quota = createQuota({ enabled: true, home: codexHome })
          if (!open && quota) { quota.stop(); quota = undefined }
        } catch { open = false }
        finally { if (!stopped) { timer = setTimeout(checkConnection, 5000); timer.unref?.() } }
      }
      void checkConnection()
      return { snapshot() {
        const value = activity.snapshot()
        const connected = open && value.closureCompanion.following
        return { ...value, connected, status: connected ? 'connected' : 'waiting', instance: 'codex',
          closureCompanion: { ...value.closureCompanion, ...quota?.snapshot(), host: 'codex' } }
      }, stop() { stopped = true; clearTimeout(timer); activity.stop(); quota?.stop() } }
    },
    dsh: () => createDsh({ directory, now }), workbuddy: () => require('./workbuddy.cjs').createWorkBuddy({ now }), ...factories,
  }
  function configure(settings) {
    for (const [host, key] of Object.entries(keys)) {
      const required = enabled && settings[key] === true && (!macMode || host !== 'workbuddy')
      if (required && !hosts.has(host)) hosts.set(host, { adapter: create[host](), previous: new Map(), connected: false })
      if (!required && hosts.has(host)) { hosts.get(host).adapter.stop(); hosts.delete(host) }
    }
  }
  function snapshot() {
    const current = [], candidates = []
    for (const [host, entry] of hosts) {
      const value = entry.adapter.snapshot()
      const baseline = !entry.connected || entry.instance !== value.instance
      const previous = baseline ? new Map() : entry.previous
      const next = new Map()
      const conversations = Array.isArray(value.conversations) ? value.conversations : [{ ...value, id: host, lastActivityAt: value.lastEventAt || 0 }]
      for (const conversation of conversations) {
        const counts = counters(conversation)
        const before = previous.get(conversation.id) || [0, 0, 0, 0, 0, 0]
        const delta = counts.map((c, i) => !baseline && Number.isSafeInteger(c) ? Math.max(0, c - before[i]) : 0)
        if (macMode) counts.push(conversation.desktopEvents?.at(-1)?.seq || 0)
        next.set(conversation.id, counts)
        if (value.connected) candidates.push({ host, value, conversation, delta, before, baseline,
          key: JSON.stringify([host, value.instance, conversation.id]),
          at: Number.isFinite(conversation.lastActivityAt) ? Math.min(conversation.lastActivityAt, now()) : 0 })
      }
      entry.previous = next; entry.instance = value.instance; entry.connected = value.connected
      current.push({ host, value })
    }
    // Compare host event timestamps, never adapter polling order or balance refreshes.
    // Every conversation's cursor advances, so ignored events cannot replay later.
    candidates.sort((a, b) => b.at - a.at || (a.key === focusKey ? -1 : b.key === focusKey ? 1 :
      Number(b.conversation.work?.active) - Number(a.conversation.work?.active) || a.key.localeCompare(b.key)))
    const selected = candidates[0]
    if ((selected?.key || null) !== focusKey) { focusKey = selected?.key || null; focusRevision++ }
    if (selected) {
      const { delta, conversation: value, host } = selected
      delta.forEach((n, i) => { totals[i] += n })
      if (delta[1]) latestEnd = { ...value.turnEnd, host }
      if (delta[3]) latestTools = { lastFailName: value.tools.lastFailName, lastFailReason: value.tools.lastFailReason, host }
      if (delta[4]) latestError = { message: value.errors.message, host }
      if (delta[5]) latestInput = { scene: value.userInput.scene, host }
      if (macMode && !selected.baseline) {
        if (Array.isArray(value.desktopEvents)) {
          for (const event of value.desktopEvents) {
            if (event.seq > (selected.before[6] || 0)) desktopEvents.push({ ...event, seq: ++desktopEventSeq })
          }
        } else {
          if (delta[0]) desktopEvents.push({ seq: ++desktopEventSeq, scene: 'start' })
          if (delta[3]) desktopEvents.push({ seq: ++desktopEventSeq, scene: 'toolFailure',
            name: value.tools.lastFailName, reason: value.tools.lastFailReason })
          if (delta[5]) desktopEvents.push({ seq: ++desktopEventSeq, scene: value.userInput.scene })
        }
        if (delta[1]) {
          const terminalEvents = Array.isArray(value.turnEnds)
            ? value.turnEnds.filter(turn => turn.seq > selected.before[1]) : [value.turnEnd]
          const offset = totals[1] - terminalEvents.length
          terminalEvents.forEach((turn, i) => turnEnds.push({ seq: offset + i + 1, kind: turn.kind }))
        }
        if (desktopEvents.length > 256) desktopEvents.splice(0, desktopEvents.length - 256)
        if (turnEnds.length > 256) turnEnds.splice(0, turnEnds.length - 256)
      }
    }
    const companion = { ...selected?.value.closureCompanion, ...selected?.conversation.closureCompanion }
    return {
      closureCompanion: { ...companion, quota: companion.quota || [], focusKey, focusRevision, following: current.some(v => v.value.connected),
        ...(macMode && { showTokenUsage: true }),
        accounts: current.filter(v => v.value.connected).map(({ host, value }) => ({ ...value.closureCompanion, host, name: names[host], connected: true })) },
      work: selected?.conversation.work || { active: false, mode: 'idle' },
      tools: { ok: totals[2], fail: totals[3], ...latestTools }, errors: { count: totals[4], ...latestError },
      userInput: { seq: totals[5], ...latestInput }, turnStartSeq: totals[0],
      turnEnd: { ...latestEnd, seq: totals[1], ...(latestEnd.kind === 'error' ? { errorSeq: totals[4] } : {}) },
      ...(macMode && { turnEnds: [...turnEnds], desktopEvents: [...desktopEvents] }),
    }
  }
  function status() {
    return Object.fromEntries([...hosts].map(([host, { adapter }]) => [host, { status: adapter.snapshot().status }]))
  }
  return { configure, snapshot, status, stop() { for (const { adapter } of hosts.values()) adapter.stop(); hosts.clear() } }
}
module.exports = { createIntegrations }
