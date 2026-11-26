const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const vm = require('node:vm')
const { EventEmitter } = require('node:events')
const { test } = require('node:test')
const { setTimeout: delay } = require('node:timers/promises')
const { createLinkedState } = require('../outputs/closure-companion/linked-state.cjs')
const { createIntegrations } = require('../outputs/closure-companion/integrations.cjs')
const { creditsFromUsage } = require('../outputs/closure-companion/workbuddy.cjs')
const { createDsh } = require('../outputs/closure-companion/dsh.cjs')
const { createActivity } = require('../outputs/closure-companion/activity.cjs')

test('latest conversation wins by event time, including completion, while old events never replay', () => {
  let at = 100, stops = [], adapters = {}
  const factories = Object.fromEntries(['codex', 'dsh', 'workbuddy'].map(host => [host, () => {
    const store = createLinkedState({ now: () => ++at })
    const adapter = { store, instance: host, connected: true, snapshot() {
      return { ...store.snapshot(), instance: this.instance, connected: this.connected, status: 'connected',
        closureCompanion: { host, source: 'official', quota: [], credits: { balance: host === 'workbuddy' ? '2100' : '1' } } }
    }, stop() { stops.push(host) } }
    adapters[host] = adapter
    return adapter
  }]))
  const hub = createIntegrations({ factories, now: () => ++at })
  hub.configure({ codexLinked: true, dshLinked: true, workbuddyLinked: true })
  hub.snapshot()
  adapters.dsh.store.event('d', 'start')
  assert.equal(hub.snapshot().turnStartSeq, 1)
  adapters.workbuddy.store.event('w', 'start')
  let value = hub.snapshot()
  assert.equal(value.work.active, true)
  assert.equal(value.turnStartSeq, 2)
  assert.equal(value.closureCompanion.host, 'workbuddy')
  adapters.dsh.store.event('d', 'end', { kind: 'error', error: { message: 'HTTP 429 secret prompt' } })
  value = hub.snapshot()
  assert.equal(value.turnEnd.host, 'dsh')
  assert.equal(value.turnEnd.kind, 'error')
  assert.equal(value.turnEnd.errorSeq, 1)
  assert.equal(value.work.active, false, 'the latest finished conversation remains selected while older work continues')
  assert.equal(value.closureCompanion.host, 'dsh')
  assert.equal(value.closureCompanion.accounts.length, 3)
  adapters.dsh.instance = 'restarted'
  hub.snapshot()
  assert.equal(hub.snapshot().turnEnd.seq, 1, 'history is not replayed on reconnection')
  hub.configure({ workbuddyLinked: true })
  value = hub.snapshot()
  assert.equal(value.turnStartSeq, 2, 'disabling one host cannot reset shared renderer counters')
  assert.equal(value.closureCompanion.accounts.length, 1)
  assert.deepEqual(stops, ['codex', 'dsh'])
  adapters.workbuddy.store.event('w', 'end', { kind: 'completed' })
  assert.equal(hub.snapshot().turnEnd.seq, 2)
  hub.stop()
})

test('events from an older conversation or host do not leak into the selected conversation', () => {
  let clock = 1000
  const stores = { codex: createLinkedState({ now: () => clock }), workbuddy: createLinkedState({ now: () => clock }) }
  const connected = { codex: true, workbuddy: true }
  const hub = createIntegrations({ now: () => clock, factories: Object.fromEntries(Object.entries(stores).map(([host, store]) => [host, () => ({
    snapshot: () => ({ ...store.snapshot(), instance: host, connected: connected[host], closureCompanion: { host, quota: [] } }), stop() {},
  })])) })
  hub.configure({ codexLinked: true, workbuddyLinked: true })
  hub.snapshot()
  stores.codex.event('old-codex', 'start', {}, 100)
  stores.codex.event('old-codex', 'tool', { failed: true }, 200)
  stores.codex.event('new-codex', 'start', {}, 300)
  stores.workbuddy.event('wb', 'start', {}, 400)
  let value = hub.snapshot()
  assert.equal(value.closureCompanion.host, 'workbuddy')
  assert.equal(value.tools.fail, 0, 'older failures are suppressed even when read in the same poll')
  assert.equal(value.turnStartSeq, 1)
  stores.codex.event('new-codex', 'end', { kind: 'error' }, 350)
  value = hub.snapshot()
  assert.equal(value.errors.count, 0)
  assert.equal(value.turnEnd.seq, 0)
  assert.equal(value.closureCompanion.host, 'workbuddy', 'an adapter polled later cannot steal focus')
  stores.codex.event('old-codex', 'mode', { mode: 'outputting' }, 500)
  value = hub.snapshot()
  assert.equal(value.closureCompanion.host, 'codex')
  assert.equal(value.work.mode, 'outputting')
  assert.equal(value.tools.fail, 0, 'switching back does not replay the ignored error')
  assert.equal(value.turnStartSeq, 1, 'switching to an already running conversation does not invent a start')
  const focus = value.closureCompanion.focusKey
  stores.codex.event('new-codex', 'start', {}, 600)
  value = hub.snapshot()
  assert.notEqual(value.closureCompanion.focusKey, focus, 'two conversations in the same host are selected independently')
  assert.equal(value.turnStartSeq, 2)
  connected.codex = false
  value = hub.snapshot()
  assert.deepEqual(value.closureCompanion.accounts.map(a => a.host), ['workbuddy'])
  assert.equal(value.work.active, true)
  assert.equal(value.errors.count, 0)
  connected.codex = true
  stores.codex.event('new-codex', 'end', { kind: 'completed' }, 700)
  value = hub.snapshot()
  assert.equal(value.turnEnd.seq, 0, 'reconnection uses a baseline instead of replaying unseen history')
  hub.stop()
})

test('macOS preserves the Codex completion queue across polls and can select DSH', () => {
  const dsh = createLinkedState({ now: () => 100 })
  const codex = { lastEventAt: 0, turnStartSeq: 0, turnEnd: { seq: 0 }, turnEnds: [], desktopEvents: [] }
  const hub = createIntegrations({ macMode: true, now: () => 100, factories: {
    codex: () => ({ snapshot: () => ({ ...codex, connected: true, instance: 'codex', closureCompanion: { host: 'codex' } }), stop() {} }),
    dsh: () => ({ snapshot: () => ({ ...dsh.snapshot(), connected: true, instance: 'dsh', closureCompanion: { host: 'dsh' } }), stop() {} }),
    workbuddy: () => { throw Error('WorkBuddy should not run on macOS') },
  } })
  hub.configure({ codexLinked: true, dshLinked: true, workbuddyLinked: true })
  hub.snapshot()
  codex.lastEventAt = 10
  codex.turnEnd = { seq: 2, kind: 'completed' }
  codex.turnEnds = [{ seq: 1, kind: 'completed' }, { seq: 2, kind: 'completed' }]
  assert.deepEqual(hub.snapshot().turnEnds, codex.turnEnds)
  dsh.event('dsh-session', 'start', {}, 20)
  const started = hub.snapshot()
  assert.equal(started.closureCompanion.host, 'dsh')
  assert.equal(started.work.active, true)
  assert.deepEqual(started.desktopEvents, [{ seq: 1, scene: 'start' }])
  dsh.event('dsh-session', 'end', { kind: 'completed' }, 25)
  assert.deepEqual(hub.snapshot().turnEnds, [...codex.turnEnds, { seq: 3, kind: 'completed' }])
  codex.lastEventAt = 30
  assert.equal(hub.snapshot().closureCompanion.host, 'codex')
  assert.equal(hub.snapshot().turnEnds.length, 3)
  assert.deepEqual(hub.snapshot().closureCompanion.accounts.map(account => account.host), ['codex', 'dsh'])
  hub.stop()
})

test('official credit parsing distinguishes real zero, signed out and failed reads', async () => {
  assert.deepEqual(creditsFromUsage({ usageLeft: '0' }), { status: 'ready', credits: { balance: '0' } })
  assert.deepEqual(creditsFromUsage({ usageLeft: '2100.5' }).credits, { balance: '2100.5' })
  assert.deepEqual(creditsFromUsage({ usageLeft: '-1' }).credits, { balance: '-1' })
  assert.equal(creditsFromUsage(null).status, 'signed-out')
  for (const value of ['', '-x', 'NaN', {}, null]) assert.equal(creditsFromUsage({ usageLeft: value }).status, 'unavailable')
  const { quotaLines } = await import('../outputs/closure-companion/upstream/assets/src/ui/bubble.js')
  const lines = quotaLines({ closureCompanion: { accounts: [
    { host: 'workbuddy', connected: true, credits: { balance: '0' } },
    { host: 'dsh', connected: true, accountStatus: 'ready', wallets: [{ currency: 'CNY', balance: '5.50' }], bonusWallets: [{ currency: 'CNY', balance: '0E-16' }] },
    { host: 'offline', connected: false, credits: { balance: '99999' } },
  ] } })
  assert.deepEqual(lines, ['WorkBuddy 积分还剩 0', 'DSH 官方余额 5.50 CNY', 'DSH 赠送余额 0.00 CNY'])
  assert.match(quotaLines({ closureCompanion: { accounts: [{ host: 'workbuddy', connected: true, accountStatus: 'unavailable' }] } })[0], /暂不可用/)
  assert.deepEqual(quotaLines({ closureCompanion: { accounts: [], credits: { balance: '99999' } } }), [])
})

test('real Codex rollouts expose independent per-conversation counters for latest-activity selection', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'closure-conversation-'))
  const date = new Date()
  const folder = path.join(directory, String(date.getFullYear()), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0'))
  await fs.mkdir(folder, { recursive: true })
  const base = Date.now() - 10000
  async function append(id, offset, payload, type = 'event_msg') {
    await fs.appendFile(path.join(folder, `rollout-${id}.jsonl`), JSON.stringify({ timestamp: new Date(base + offset).toISOString(), type, payload }) + '\n')
  }
  await append('a', 1, { type: 'task_started', turn_id: 'a' })
  await append('b', 2, { type: 'task_started', turn_id: 'b-old' })
  await append('b', 3, { type: 'task_complete', turn_id: 'b-old' })
  const activity = createActivity(true, directory)
  const hub = createIntegrations({ factories: { codex: () => ({ snapshot: () => ({ ...activity.snapshot(), instance: 'codex', connected: true, closureCompanion: { host: 'codex', quota: [] } }), stop() {} }) } })
  t.after(async () => { hub.stop(); activity.stop(); await fs.rm(directory, { recursive: true, force: true }) })
  hub.configure({ codexLinked: true })
  hub.snapshot()
  await append('a', 4, { type: 'item_completed', turn_id: 'a', item: { type: 'McpToolCall', tool: 'web.search', status: 'failed' } })
  await append('b', 5, { type: 'task_started', turn_id: 'b' })
  await append('b', 6, { type: 'message', role: 'assistant', content: [] }, 'response_item')
  for (let i = 0; i < 50 && activity.snapshot().tools.fail !== 1; i++) await delay(50)
  let result = hub.snapshot()
  assert.match(result.closureCompanion.focusKey, /rollout-b/)
  assert.equal(result.tools.fail, 0)
  assert.equal(result.turnStartSeq, 1)
  await append('a', 7, { type: 'task_complete', turn_id: 'a' })
  for (let i = 0; i < 50 && activity.snapshot().turnEnd.seq !== 1; i++) await delay(50)
  result = hub.snapshot()
  assert.match(result.closureCompanion.focusKey, /rollout-a/)
  assert.equal(result.work.active, false)
  assert.equal(result.turnEnd.seq, 1)
  assert.equal(result.tools.fail, 0)
})

test('balance changes and legacy reminder settings never create automatic bubbles; focus switches reset speech timers', async () => {
  const { createState } = await import('../outputs/closure-companion/upstream/assets/src/io/state.js')
  const { normalizeSettings } = await import('../outputs/closure-companion/upstream/assets/src/shared/protocol.js')
  assert.equal(normalizeSettings({ quotaReminderMinutes: 5 }).quotaReminderMinutes, 0)
  const spoken = [], messages = []
  let clock = 10000, hidden = 0
  const oldNow = Date.now
  Date.now = () => clock
  try {
    const ui = createState({ layers: {}, settings: { quotaReminderMinutes: 1, toolFailureNotice: true },
      showDialogue: scene => { spoken.push(scene); return true }, showBubble: text => messages.push(text), showQuota: () => { throw Error('Automatic balance lookup must never run') },
      playOverlay: (_name, _duration, callback) => callback?.(), playSound() {}, scheduleStartup() {}, syncAnimation() {},
      hideDialogue: () => hidden++, isBubbleShown: () => false,
    })
    const state = (focusKey, remaining = 100) => ({ closureCompanion: { focusKey, source: 'official', quota: [{ minutes: 300, remaining }] },
      work: { mode: 'thinking', active: true }, tools: { ok: 0, fail: 0 }, errors: { count: 0 }, turnStartSeq: 0, turnEnd: { seq: 0 } })
    ui.applyState(state('a'))
    clock += 14000
    ui.applyState(state('b', 5))
    assert.equal(hidden, 1)
    clock += 14000
    ui.applyState(state('b', 100))
    assert.deepEqual(spoken, [])
    clock += 1000
    ui.applyState(state('b'))
    assert.deepEqual(spoken, ['working'])
    assert.deepEqual(messages, [], 'quota low and recovered transitions remain silent')
    ui.dispose()
  } finally { Date.now = oldNow }
})

test('WorkBuddy SDK observer seeds history, follows native transitions and emits sanitized facts once', async () => {
  const bus = new EventEmitter()
  let requestListener, released = 0
  const wb = {
    on(event, fn) { bus.on(event, fn); return () => { bus.off(event, fn); released++ } },
    conversations: {
      on(event, fn) { assert.equal(event, 'requestUpdated'); requestListener = fn; return () => released++ },
      onConversationChanged() { return () => released++ },
      listScope: async () => ({ items: [{ id: 'old', state: 'idle', title: 'private old prompt', transport: 'local' }] }),
    },
  }
  const window = { wb }
  const source = await fs.readFile(path.join(__dirname, '../outputs/closure-companion/workbuddy-renderer.js'), 'utf8')
  vm.runInNewContext(source, { window, crypto: { randomUUID: () => 'instance' }, Date, setInterval: () => 1, clearInterval() {} })
  await delay(0)
  assert.equal(window.__closureCompanionBridge.snapshot().sequence, 0)
  bus.emit('wb:conversation:stateChange', { conversationId: 'old', from: 'idle', to: 'working' })
  requestListener('old', 'r', 'm', { sessionUpdate: 'agent_message_chunk', content: { text: 'private response' } })
  const tool = { sessionUpdate: 'tool_call_update', toolCallId: 't', status: 'failed', rawOutput: 'secret' }
  requestListener('old', 'r', 'm', tool)
  requestListener('old', 'r', 'm', tool)
  bus.emit('wb:conversation:stateChange', { conversationId: 'old', from: 'working', to: 'idle' })
  const snapshot = window.__closureCompanionBridge.snapshot()
  assert.deepEqual(Array.from(snapshot.events, v => v.kind), ['start', 'mode', 'tool', 'end'])
  assert.equal(snapshot.events.at(-1).data.kind, 'completed')
  assert.doesNotMatch(JSON.stringify(snapshot), /secret|private/)
  window.__closureCompanionBridge.dispose()
  assert.equal(window.__closureCompanionBridge, undefined)
  assert.ok(released >= 6)
})

test('DSH native plugin excludes subagents, uses only the official account service, and expires its lease', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'closure-dsh-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const bus = new EventEmitter(), disposers = []
  let calls = 0
  const ctx = {
    on: bus.on.bind(bus), effect(fn) { disposers.push(fn()) }, agents: { list: () => [] },
    deepseekAccount: { async getBalance(client) { calls++; assert.equal(client.locale, 'zh-CN'); return { status: 'ready', value: [{ currency: 'CNY', balance: '12.30' }], bonusWallets: [] } } },
  }
  const { apply } = await import('../plugins/dsh-closure-companion-bridge/lib/index.js')
  await fs.writeFile(path.join(directory, 'dsh-request.json'), JSON.stringify({ enabled: true, updatedAt: Date.now() }))
  apply(ctx, { directory })
  t.after(async () => { for (const fn of disposers) await fn() })
  await delay(1200)
  const main = { id: 'main', header: {} }, child = { id: 'child', header: { origin: 'subagent' } }
  for (const session of [main, child]) bus.emit('session/event', session, { type: 'turn/start', data: { turn: 1 } })
  bus.emit('session/event', main, { type: 'tool/call', data: { callId: 'q', name: 'ask_user_question', arguments: 'private question' } })
  bus.emit('session/event', main, { type: 'tool/result', data: { message: { toolCallId: 'q', isError: false, content: [{ type: 'text', text: JSON.stringify({ answers: [{ id: 'q', custom: 'private answer' }] }) }] } } })
  bus.emit('session/event', main, { type: 'turn/end', data: { reason: { kind: 'completed' } } })
  await delay(1100)
  const data = JSON.parse(await fs.readFile(path.join(directory, 'dsh.json'), 'utf8'))
  assert.equal(data.state.turnStartSeq, 1)
  assert.equal(data.state.turnEnd.seq, 1)
  assert.equal(data.state.userInput.seq, 2)
  assert.equal(data.state.userInput.scene, 'answer')
  assert.equal(data.balance.wallets[0].balance, '12.30')
  assert.doesNotMatch(JSON.stringify(data), /private/)
  assert.ok(calls >= 1)
  bus.emit('session/event', main, { type: 'tool/call', data: { callId: 'pending', name: 'ask_user_question', arguments: '{}' } })
  bus.emit('session/event', main, { type: 'tool/result', data: { message: { toolCallId: 'pending', content: [{ type: 'text', text: '{"pending":true}' }] } } })
  await delay(1100)
  const pending = JSON.parse(await fs.readFile(path.join(directory, 'dsh.json'), 'utf8'))
  assert.equal(pending.state.userInput.seq, 3, 'timeout must not masquerade as a user answer')
  assert.equal(pending.state.userInput.scene, 'question')
  bus.emit('session/event', main, { type: 'user/message', data: { source: { kind: 'user-question-reply', outcome: 'answered' }, content: 'private late answer' } })
  await delay(1100)
  assert.equal(JSON.parse(await fs.readFile(path.join(directory, 'dsh.json'), 'utf8')).state.userInput.scene, 'answer')
  const reader = createDsh({ directory })
  await reader.ready
  assert.equal(reader.snapshot().connected, true)
  assert.equal(reader.snapshot().closureCompanion.wallets[0].balance, '12.30')
  reader.stop()
  await delay(1200)
  const before = calls
  bus.emit('session/event', main, { type: 'turn/start', data: {} })
  await delay(1100)
  assert.equal(calls, before)
  assert.equal(JSON.parse(await fs.readFile(path.join(directory, 'dsh.json'), 'utf8')).state.turnStartSeq, 1)
})
