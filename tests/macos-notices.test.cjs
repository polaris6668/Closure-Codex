const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { test } = require('node:test')
const { EventEmitter } = require('node:events')
const { setTimeout: delay } = require('node:timers/promises')
const { createActivity } = require('../outputs/closure-companion/activity.cjs')

test('desktop delivers structured questions, answers, failed tools, and usage in one poll', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'closure-notices-'))
  const now = new Date()
  const date = [now.getFullYear(), now.getMonth() + 1, now.getDate()].map((part) => String(part).padStart(2, '0'))
  const folder = path.join(root, ...date)
  fs.mkdirSync(folder, { recursive: true })
  const activity = createActivity(true, root, { desktopOnly: true })
  t.after(() => {
    activity.stop()
    fs.rmSync(root, { recursive: true, force: true })
  })
  const timestamp = new Date().toISOString()
  const line = (type, payload) => JSON.stringify({ timestamp, type, payload })
  fs.writeFileSync(path.join(folder, 'rollout-main.jsonl'), [
    line('session_meta', { originator: 'Codex Desktop', source: 'vscode' }),
    line('event_msg', { type: 'task_started', turn_id: 'one' }),
    line('response_item', { type: 'function_call', call_id: 'q', name: 'functions.request_user_input' }),
    line('response_item', { type: 'function_call_output', call_id: 'q', output: { answers: { answer: { answers: ['fixture'] } } } }),
    line('event_msg', { type: 'item_completed', turn_id: 'one', item: { type: 'McpToolCall', tool: 'web_run', status: 'failed' } }),
    line('event_msg', { type: 'token_count', info: { total_token_usage: { total_tokens: 19 }, last_token_usage: { total_tokens: 8 } },
      rate_limits: { primary: { used_percent: 9, window_minutes: 300, resets_at: Math.floor(Date.now() / 1000) + 60 } } }),
    line('event_msg', { type: 'task_complete', turn_id: 'one' }),
    '',
  ].join('\n'))
  for (let round = 0; round < 80 && activity.snapshot().turnEnds.length === 0; round++) await delay(35)
  const snapshot = activity.snapshot()
  assert.deepEqual(snapshot.desktopEvents.map(({ scene }) => scene), ['start', 'question', 'answer', 'toolFailure'])
  assert.deepEqual(snapshot.turnEnds, [{ seq: 1, kind: 'completed' }])
  assert.equal(snapshot.desktopEvents[3].name, 'web_run')
  assert.equal(snapshot.closureCompanion.quota[0].remaining, 91)
  assert.deepEqual(snapshot.closureCompanion.tokenUsage, { total: 19, turn: 8 })
})

test('desktop recovers missed file events without replaying completed turns', async (t) => {
  const watcher = new EventEmitter()
  watcher.close = () => {}
  t.mock.method(fs, 'watch', () => watcher)
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'closure-scan-'))
  const oldFolder = path.join(root, '2021', '01', '01')
  fs.mkdirSync(oldFolder, { recursive: true })
  const file = path.join(oldFolder, 'rollout-resumed.jsonl')
  const record = (type, payload, at = Date.now()) => JSON.stringify({ timestamp: new Date(at).toISOString(), type, payload }) + '\n'
  const meta = record('session_meta', { originator: 'Codex Desktop', source: 'vscode' })
  const turn = (type, turn_id, at) => record('event_msg', { type, turn_id }, at)
  const past = Date.now() - 1000
  fs.writeFileSync(file, meta + turn('task_started', 'old', past) + turn('task_complete', 'old', past) + turn('task_started', 'current', past))
  const activity = createActivity(true, root, { desktopOnly: true })
  t.after(() => {
    activity.stop()
    fs.rmSync(root, { recursive: true, force: true })
  })
  assert.equal(activity.snapshot().work.active, true)
  assert.deepEqual(activity.snapshot().turnEnds, [])
  fs.appendFileSync(file, turn('task_complete', 'current'))
  const freshFolder = path.join(root, '2026', '01', '01')
  fs.mkdirSync(freshFolder, { recursive: true })
  fs.writeFileSync(path.join(freshFolder, 'rollout-new.jsonl'), meta + turn('task_started', 'new') + turn('task_complete', 'new'))

  for (let round = 0; round < 80 && activity.snapshot().turnEnds.length < 2; round++) await delay(50)
  const expected = [{ seq: 1, kind: 'completed' }, { seq: 2, kind: 'completed' }]
  assert.deepEqual(activity.snapshot().turnEnds, expected)
  assert.equal(activity.snapshot().work.active, false)
  await delay(1700)
  assert.deepEqual(activity.snapshot().turnEnds, expected)

  fs.appendFileSync(file, turn('task_started', 'archive-me'))
  for (let round = 0; round < 80 && !activity.snapshot().work.active; round++) await delay(50)
  assert.equal(activity.snapshot().work.active, true)
  const startSequence = activity.snapshot().turnStartSeq
  const archive = path.join(root, 'archived.jsonl')
  fs.renameSync(file, archive)
  for (let round = 0; round < 80 && activity.snapshot().work.active; round++) await delay(50)
  assert.equal(activity.snapshot().work.active, false, 'archiving without a watch event clears active work')
  assert.deepEqual(activity.snapshot().turnEnds, expected, 'archiving does not synthesize a completion')

  fs.renameSync(archive, file)
  fs.appendFileSync(file, turn('task_complete', 'archive-me'))
  for (let round = 0; round < 80 && activity.snapshot().turnEnds.length < 3; round++) await delay(50)
  assert.equal(activity.snapshot().turnStartSeq, startSequence, 'restoring a rollout does not replay its start')
  assert.deepEqual(activity.snapshot().turnEnds, [...expected, { seq: 3, kind: 'completed' }])
})
