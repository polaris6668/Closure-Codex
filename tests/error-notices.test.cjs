const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { setTimeout: delay } = require('node:timers/promises')
const { test } = require('node:test')
const { createActivity } = require('../outputs/closure-companion/activity.cjs')
const { summarizeError, summarizeToolError } = require('../outputs/closure-companion/error-summary.cjs')

test('summaries use codes and known causes without forwarding raw details', () => {
  assert.equal(summarizeError({ codex_error_info: 'ContextWindowExceeded' }), '超出模型上下文长度')
  assert.equal(summarizeError({ codexErrorInfo: { responseStreamDisconnected: { httpStatusCode: 502 } } }), '上游服务响应异常（HTTP 502）')
  assert.equal(summarizeToolError({ result: { content: [{ type: 'text', text: 'MCP error -32602: private values' }] } }), '工具参数无效（-32602）')
  assert.equal(summarizeToolError({ error: { message: 'MCP startup failed: transport channel closed' } }), '服务连接中断')
  assert.equal(summarizeToolError({ result: { content: [{ type: 'text', text: 'unrecognized payload private values' }] } }), '')
})

test('tool and turn failure reasons reach the desktop notification', async (t) => {
  const { createState } = await import('../outputs/closure-companion/upstream/assets/src/io/state.js')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'closure-errors-'))
  const date = new Date()
  const folder = path.join(root, String(date.getFullYear()), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0'))
  fs.mkdirSync(folder, { recursive: true })
  const log = path.join(folder, 'rollout-notices.jsonl')
  function append(payload, type = 'event_msg') {
    const record = { timestamp: new Date().toISOString(), type, payload }
    fs.appendFileSync(log, JSON.stringify(record) + '\n')
  }
  append({ type: 'task_started', turn_id: 'first' })
  const activity = createActivity(true, root)
  t.after(() => {
    activity.stop()
    fs.rmSync(root, { recursive: true, force: true })
  })
  const shown = []
  const toolDialogues = []
  const settings = { toolFailureNotice: true }
  let completions = 0
  const ui = createState({
    settings, layers: {}, playOverlay: (_name, _done, begin) => begin(),
    showBubble: (message) => shown.push(message),
    showDialogue: (scene, message) => {
      if (scene === 'completion') completions++
      if (scene === 'toolFailure') toolDialogues.push(message)
    },
    syncAnimation() {}, playSound() {}, scheduleStartup() {}, isBubbleShown: () => false,
  })
  async function syncWhen(matches) {
    let snapshot = activity.snapshot()
    for (let i = 0; i < 60 && !matches(snapshot); i++) {
      await delay(50)
      snapshot = activity.snapshot()
    }
    assert.equal(matches(snapshot), true)
    ui.applyState(snapshot)
    return snapshot
  }
  ui.applyState(activity.snapshot())
  append({ type: 'item_completed', turn_id: 'first', item: {
    type: 'McpToolCall', tool: 'web.search', status: 'completed',
    result: { isError: true, content: [{ type: 'text', text: 'HTTP 429: private values' }] },
  } })
  const tool = await syncWhen((s) => s.tools.fail === 1)
  assert.equal(tool.tools.lastFailReason, '请求频率或额度受限（HTTP 429）')
  assert.equal(shown.at(-1), '博士，web.search 报错了。\n请求频率或额度受限（HTTP 429）')

  append({ type: 'item_completed', turn_id: 'first', item: { type: 'CommandExecution', status: 'failed', exit_code: 1 } })
  append({ type: 'error', turn_id: 'first', willRetry: true, message: 'request timed out' })
  append({ type: 'function_call', call_id: 'survey', name: 'mcp__survey__request_user_input' }, 'response_item')
  append({ type: 'function_call_output', call_id: 'survey', output: { answers: { one: { answers: ['fixture'] } } } }, 'response_item')
  append({ type: 'function_call', call_id: 'async-survey', name: 'mcp__survey__request_user_input_async' }, 'response_item')
  append({ type: 'function_call_output', call_id: 'async-survey', output: { accepted: true } }, 'response_item')
  append({ type: 'task_complete', turn_id: 'first' })
  const recovered = await syncWhen((s) => s.turnEnd.seq === 1)
  assert.deepEqual(recovered.userInput, { seq: 0, scene: null }, 'MCP tools with matching suffixes must not emit built-in input events')
  assert.equal(recovered.tools.fail, 1)
  assert.equal(recovered.errors.count, 0)
  assert.equal(completions, 1)

  append({ type: 'task_started', turn_id: 'second' })
  append({ type: 'error', turn_id: 'second', codex_error_info: 'ContextWindowExceeded' })
  append({ type: 'task_complete', turn_id: 'second' })
  await syncWhen((s) => s.turnEnd.seq === 2)
  assert.equal(shown.at(-1), '博士，这轮卡在这儿了。\n超出模型上下文长度')
  assert.equal(shown.length, 2)

  append({ type: 'task_started', turn_id: 'third' })
  append({ type: 'error', turn_id: 'third', error: { message: 'request timed out' } })
  await syncWhen((s) => s.errors.count === 2)
  assert.equal(shown.at(-1), '嗯？怎么在这儿报错了？\n请求超时')
  append({ type: 'task_complete', turn_id: 'third' })
  await syncWhen((s) => s.turnEnd.seq === 3)
  assert.equal(shown.length, 3)

  append({ type: 'task_started', turn_id: 'fourth' })
  append({ type: 'turn_aborted', turn_id: 'fourth', reason: 'interrupted' })
  await syncWhen((s) => s.turnEnd.seq === 4)
  assert.equal(shown.at(-1), '欸，这轮停了。博士，还接着做吗？')

  append({ type: 'task_started', turn_id: 'fifth' })
  append({ type: 'item_completed', turn_id: 'fifth', item: {
    type: 'McpToolCall', tool: 'private.provider', server: 'api.private.test', status: 'failed',
    error: { message: 'HTTP 403: private provider address' },
  } })
  const hidden = await syncWhen((s) => s.tools.fail === 2)
  assert.equal(hidden.tools.lastFailName, '')
  assert.equal(hidden.tools.lastFailReason, '权限不足或访问被拒绝（HTTP 403）')
  assert.equal(shown.at(-1), '博士，刚才那个工具没跑起来。\n权限不足或访问被拒绝（HTTP 403）')
  assert.deepEqual(toolDialogues, [shown[0], shown.at(-1)])
})
