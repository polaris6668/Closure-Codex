const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { test } = require('node:test')
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
