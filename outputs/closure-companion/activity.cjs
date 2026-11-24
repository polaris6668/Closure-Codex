const fs = require('node:fs')
const path = require('node:path')
const { summarizeError, summarizeToolError } = require('./error-summary.cjs')

const tailLimit = 256 * 1024
const activeTimeout = 20 * 60 * 1000
const quotaTimeout = 30 * 60 * 1000
const desktopScanInterval = 1500
const talkHold = 2200 // Keep a short response visible across a one-second renderer poll.
const rolloutName = /^rollout-[\w-]+\.jsonl$/i
const publicToolNames = new Set(['web.search', 'web_run', 'search_service.web_run', 'apply_patch', 'exec_command'])

function parseToolOutput(output) {
  if (typeof output !== 'string') return output
  try { return JSON.parse(output) } catch { return null }
}

function createActivity(enabled, sessionsRoot, { desktopOnly = false } = {}) {
  const files = new Map()
  const pending = new Map()
  const tools = { ok: 0, fail: 0 }
  let turnStartSeq = 0
  const turnEnd = { seq: 0, kind: 'completed', at: 0 }
  const turnEnds = []
  const desktopEvents = []
  let desktopEventSeq = 0
  const errors = { count: 0 }
  const userInput = { seq: 0, scene: null }
  const startedAt = Date.now()
  let rateLimits = { at: 0, windows: [] }
  let watcher
  let desktopScanTimer

  function desktopEvent(scene, detail = {}) {
    if (!desktopOnly) return
    desktopEvents.push({ seq: ++desktopEventSeq, scene, ...detail })
    if (desktopEvents.length > 256) desktopEvents.shift()
  }

  function noteUserInput(scene, notify) {
    if (!notify) return
    userInput.seq++
    userInput.scene = scene
    desktopEvent(scene)
  }

  function trackUserInput(event, session, notify) {
    if (session.subagent) return
    if (event.type === 'function_call' && typeof event.call_id === 'string') {
      const name = typeof event.name === 'string' ? event.name.split(/__|[.:/]/).at(-1) : ''
      if (name === 'request_user_input') {
        if (session.inputCalls.has(event.call_id)) return
        session.inputCalls.set(event.call_id, false)
        noteUserInput('question', notify)
      } else if (name === 'request_user_input_async') {
        session.inputCalls.set(event.call_id, true)
      }
    } else if (event.type === 'function_call_output' && session.inputCalls.has(event.call_id)) {
      const asynchronous = session.inputCalls.get(event.call_id)
      session.inputCalls.delete(event.call_id)
      const output = parseToolOutput(event.output)
      if (asynchronous && output?.accepted === true) {
        session.awaitingAnswers++
        noteUserInput('question', notify)
      } else if (!asynchronous && Object.values(output?.answers ?? {}).some((answer) =>
        Array.isArray(answer?.answers) && answer.answers.some((text) => typeof text === 'string' && text.trim())
      )) {
        noteUserInput('answer', notify)
      }
    } else if (session.awaitingAnswers && event.type === 'message' && event.role === 'user' &&
      event.content?.some?.(({ type, text }) => type === 'input_text' && typeof text === 'string' &&
        text.startsWith('<send_user_message_question_reply>') && text.trimEnd().endsWith('</send_user_message_question_reply>'))) {
      session.awaitingAnswers--
      noteUserInput('answer', notify)
    }
  }

  function applyLine(line, session, notify) {
    let record
    try { record = JSON.parse(line) } catch { return }
    if (!record.payload) return
    const event = record.payload
    const at = Date.parse(record.timestamp)
    if (record.type === 'session_meta') {
      session.subagent = Boolean(event.source?.subagent || event.parent_thread_id)
      session.desktop = event.originator === 'Codex Desktop'
      return
    }
    if (desktopOnly) {
      if (!session.desktop || session.subagent) return
      if (session.turn && Number.isFinite(at)) session.activityAt = Math.max(session.activityAt, at)
      notify = notify && at >= startedAt
    }
    if (record.type === 'response_item') {
      trackUserInput(event, session, notify)
      if (session.turn && event.type === 'message' && event.role === 'assistant') {
        session.mode = 'outputting'
        if (Number.isFinite(at)) {
          session.activityAt = Math.max(session.activityAt, at)
          if (notify) session.talkUntil = at + talkHold
        }
      }
      return
    }
    if (record.type !== 'event_msg') return

    if (event.type === 'token_count') {
      const total = event.info?.total_token_usage?.total_tokens
      if (Number.isSafeInteger(total) && total >= 0 && Number.isFinite(at)) {
        if (session.turn && (session.turnStartTokens === null || total < session.totalTokens)) {
          const last = event.info.last_token_usage?.total_tokens
          session.turnStartTokens = Number.isSafeInteger(last) && last >= 0 && last <= total ? total - last : null
        }
        session.totalTokens = total
        if (session.turn) {
          session.turnTokens = session.turnStartTokens === null ? null : total - session.turnStartTokens
        }
        session.activityAt = Math.max(session.activityAt, at)
      }
      const limits = event.rate_limits
      if (!limits || (limits.limit_id && limits.limit_id !== 'codex') || !Number.isFinite(at) || at < rateLimits.at) return
      const windows = [limits.primary, limits.secondary].filter((entry) =>
        Number.isFinite(entry?.used_percent) && entry.used_percent >= 0 && entry.used_percent <= 100 &&
        Number.isInteger(entry.window_minutes) && entry.window_minutes > 0 && Number.isFinite(entry.resets_at)
      ).map((entry) => ({ minutes: entry.window_minutes, remaining: 100 - entry.used_percent, resetsAt: entry.resets_at * 1000 }))
      if (windows.length) rateLimits = { at, windows }
      return
    }

    if (event.type === 'task_started') {
      if (typeof event.turn_id !== 'string' || session.turn === event.turn_id) return
      if (notify && !session.subagent) {
        turnStartSeq++
        desktopEvent('start')
      }
      session.turn = event.turn_id
      session.mode = 'thinking'
      session.error = null
      session.talkUntil = 0
      session.turnStartTokens = session.totalTokens
      session.turnTokens = null
      if (Number.isFinite(at)) session.activityAt = Math.max(session.activityAt, at)
      return
    }
    if (!session.turn || (event.turn_id && event.turn_id !== session.turn)) return

    if (event.type === 'agent_message' ||
        (['item_started', 'item_completed'].includes(event.type) && event.item?.type === 'AgentMessage')) {
      session.mode = 'outputting'
      if (Number.isFinite(at)) session.activityAt = Math.max(session.activityAt, at)
      if (notify && Number.isFinite(at)) session.talkUntil = at + talkHold
    } else if (['item_started', 'item_completed'].includes(event.type) &&
        ['CommandExecution', 'McpToolCall', 'FileChange'].includes(event.item?.type)) {
      session.mode = 'thinking'
      if (Number.isFinite(at)) session.activityAt = Math.max(session.activityAt, at)
      if (event.type !== 'item_completed') return
      const item = event.item
      const mcp = item.type === 'McpToolCall'
      const toolError = (mcp || desktopOnly) && (item.status === 'failed' || item.result?.isError === true || item.result?.is_error === true)
      // A command can run normally and still return a nonzero result (for example, a search with no matches).
      if (notify && toolError) {
        tools.fail++
        tools.lastFailName = publicToolNames.has(item.tool) ? item.tool : ''
        tools.lastFailReason = summarizeToolError(item)
        desktopEvent('toolFailure', { name: tools.lastFailName, reason: tools.lastFailReason })
      }
      else if (notify && item.status === 'completed' && (item.exit_code ?? 0) === 0) tools.ok++
    } else if (event.type === 'error' && !event.will_retry && !event.willRetry) {
      session.talkUntil = 0
      const details = event.error ?? event
      session.error = { reason: summarizeError(details), seq: 0 }
      if (notify) {
        session.error.seq = ++errors.count
        errors.message = session.error.reason
      }
    } else if (event.type === 'task_complete' || event.type === 'turn_aborted') {
      if (Number.isFinite(at)) session.activityAt = Math.max(session.activityAt, at)
      const aborted = event.type === 'turn_aborted'
      const terminalError = desktopOnly && event.error
      const kind = aborted ? (terminalError && event.reason !== 'interrupted' ? 'error' : 'interrupted')
        : (session.error || terminalError ? 'error' : 'completed')
      session.turn = null
      session.mode = null
      session.inputCalls.clear()
      if (kind !== 'completed') session.talkUntil = 0
      if (notify && !session.subagent) {
        turnEnd.seq++
        turnEnd.kind = kind
        turnEnd.at = Date.now()
        turnEnd.errorSeq = kind === 'error' ? (session.error?.seq || 0) : 0
        turnEnd.reason = kind === 'error' ? (session.error?.reason || summarizeError(event.error))
          : kind === 'interrupted' && event.reason === 'interrupted' ? '本轮被中断' : ''
        if (desktopOnly) {
          turnEnds.push({ seq: turnEnd.seq, kind })
          if (turnEnds.length > 256) turnEnds.shift()
        }
      }
    }
  }

  function readDesktopLines(fd, size, session, notify) {
    const chunk = Buffer.alloc(Math.min(tailLimit, size - session.offset))
    const lineLimit = 8 * 1024 * 1024
    let parts = []
    let lineSize = 0
    for (let position = session.offset; position < size;) {
      const count = fs.readSync(fd, chunk, 0, Math.min(chunk.length, size - position), position)
      if (!count) break
      const data = chunk.subarray(0, count)
      for (let start = 0; start < count;) {
        const newline = data.indexOf(10, start)
        const end = newline === -1 ? count : newline
        lineSize += end - start
        if (lineSize <= lineLimit) {
          const part = data.subarray(start, end)
          if (newline === -1) parts.push(Buffer.from(part))
          else applyLine((parts.length ? Buffer.concat([...parts, part]) : part).toString('utf8'), session, notify)
        }
        if (newline === -1) break
        session.offset = position + end + 1
        parts = []
        lineSize = 0
        start = end + 1
      }
      position += count
    }
  }

  function readTail(filename, notifyExisting = true) {
    let fd
    try {
      fd = fs.openSync(filename, 'r')
      const { size, mtimeMs, birthtimeMs } = fs.fstatSync(fd)
      const prior = files.get(filename)
      const truncated = prior && prior.offset > size
      const session = prior && !truncated ? prior : {
        offset: 0, updated: 0, turn: null, mode: null, talkUntil: 0, error: null,
        activityAt: 0, totalTokens: null, turnStartTokens: null, turnTokens: null,
        inputCalls: new Map(), awaitingAnswers: 0,
      }
      if (desktopOnly) {
        session.updated = mtimeMs
        session.observedSize = size
        files.set(filename, session)
        if (size !== session.offset) readDesktopLines(fd, size, session, notifyExisting && !truncated)
        return
      }
      if (size === session.offset) return
      // A new rollout may finish before its first watch callback.
      const notify = notifyExisting && !truncated && (Boolean(prior) || birthtimeMs >= startedAt)
      const start = Math.max(session.offset, size - tailLimit)
      if ((!prior || truncated) && start > 0) {
        const head = Buffer.alloc(Math.min(tailLimit, size))
        const headBytes = fs.readSync(fd, head, 0, head.length, 0)
        const firstLine = head.indexOf(10)
        if (firstLine >= 0 && firstLine < headBytes) {
          applyLine(head.toString('utf8', 0, firstLine), session, false)
        }
      }
      const data = Buffer.alloc(size - start)
      const bytes = fs.readSync(fd, data, 0, data.length, start)
      session.updated = mtimeMs
      files.set(filename, session)
      if (bytes === 0) return
      const end = data.lastIndexOf(10, bytes - 1)
      if (end < 0) return
      // The writer may be between chunks. Resume immediately after the final newline.
      session.offset = start + end + 1
      for (const line of data.subarray(0, end).toString('utf8').split('\n')) applyLine(line, session, notify)
    } catch (error) {
      if (error.code === 'ENOENT') files.delete(filename)
    } finally {
      if (fd !== undefined) fs.closeSync(fd)
    }
  }

  function queue(filename) {
    if (!filename || !rolloutName.test(path.basename(filename))) return
    const full = path.resolve(sessionsRoot, filename)
    if (!full.startsWith(sessionsRoot + path.sep) || pending.has(full)) return
    pending.set(full, setTimeout(() => {
      pending.delete(full)
      readTail(full)
    }, 180))
  }

  function scanDesktopRollouts(notify = true) {
    let entries
    try { entries = fs.readdirSync(sessionsRoot, { recursive: true }) } catch { return }
    const cutoff = notify ? startedAt : startedAt - quotaTimeout
    for (const relative of entries) {
      if (!rolloutName.test(path.basename(relative))) continue
      const filename = path.join(sessionsRoot, relative)
      let stat
      try { stat = fs.statSync(filename, { throwIfNoEntry: false }) } catch { continue }
      if (!stat?.isFile()) continue
      const session = files.get(filename)
      if (session ? session.updated === stat.mtimeMs && session.observedSize === stat.size : stat.mtimeMs < cutoff) continue
      readTail(filename, notify)
    }
  }

  if (enabled && fs.existsSync(sessionsRoot)) {
    try {
      watcher = fs.watch(sessionsRoot, { recursive: true }, (_event, filename) => queue(filename))
      watcher.on('error', () => { watcher?.close(); watcher = undefined })
      if (!desktopOnly) {
        for (const offset of [0, 1]) {
          const date = new Date()
          date.setDate(date.getDate() - offset)
          const month = String(date.getMonth() + 1).padStart(2, '0')
          const day = String(date.getDate()).padStart(2, '0')
          const folder = path.join(sessionsRoot, String(date.getFullYear()), month, day)
          if (!fs.existsSync(folder)) continue
          for (const name of fs.readdirSync(folder)) {
            if (!rolloutName.test(name)) continue
            const filename = path.join(folder, name)
            if (Date.now() - fs.statSync(filename, { throwIfNoEntry: false })?.mtimeMs < quotaTimeout) readTail(filename, false)
          }
        }
      }
    } catch { watcher?.close(); watcher = undefined }
  }

  if (enabled && desktopOnly) {
    // A recursive FSEvents watcher can miss changes to existing rollouts on macOS.
    scanDesktopRollouts(false)
    desktopScanTimer = setInterval(scanDesktopRollouts, desktopScanInterval)
    desktopScanTimer.unref()
  }

  return {
    snapshot() {
      const now = Date.now()
      let active
      let latest
      const newer = (session, prior) => !prior || session.activityAt > prior.activityAt ||
        (session.activityAt === prior.activityAt && session.updated > prior.updated)
      for (const session of files.values()) {
        if (session.subagent || (desktopOnly && !session.desktop)) continue
        if (session.activityAt && newer(session, latest)) latest = session
        if (session.turn && now - session.activityAt <= activeTimeout && newer(session, active)) active = session
      }
      if (!desktopOnly) {
        for (const [filename, session] of files) {
          if (session !== latest && now - session.updated > activeTimeout) files.delete(filename)
        }
      }
      const selected = active || latest
      return {
        closureCompanion: {
          following: Boolean(watcher || desktopScanTimer), completed: now - turnEnd.at < 10000 && turnEnd.kind === 'completed',
          quota: now - rateLimits.at < quotaTimeout ? rateLimits.windows.filter((entry) => entry.resetsAt > now) : [],
          tokenUsage: selected?.totalTokens == null ? null : {
            total: selected.totalTokens, turn: selected.turnTokens,
          },
        },
        work: { mode: selected?.talkUntil > now ? 'outputting' : active?.mode || 'idle', active: Boolean(active) },
        tools: { ...tools },
        errors: { ...errors },
        userInput: { ...userInput },
        turnStartSeq,
        turnEnd: { seq: turnEnd.seq, kind: turnEnd.kind, errorSeq: turnEnd.errorSeq, reason: turnEnd.reason },
        ...(desktopOnly && { turnEnds: [...turnEnds], desktopEvents: [...desktopEvents] }),
      }
    },
    stop() {
      watcher?.close()
      clearInterval(desktopScanTimer)
      for (const timer of pending.values()) clearTimeout(timer)
      pending.clear()
    },
  }
}

module.exports = { createActivity }
