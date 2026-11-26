const { summarizeError } = require('./error-summary.cjs')

// Only normalized activity facts leave the host. Prompts, tool arguments,
// answers, account identities and credentials never enter a bridge snapshot.
function createLinkedState({ now = Date.now } = {}) {
  const sessions = new Map()
  const empty = () => ({
    work: { mode: 'idle', active: false }, tools: { ok: 0, fail: 0 }, errors: { count: 0 },
    userInput: { seq: 0, scene: null }, turnStartSeq: 0, turnEnd: { seq: 0, kind: 'completed' }, lastEventAt: 0,
  })
  const state = empty()
  function session(id) {
    if (!sessions.has(id)) sessions.set(id, { ...empty(), id, active: false, mode: 'idle', at: 0, activitySeq: 0 })
    return sessions.get(id)
  }
  function event(id, kind, data = {}, at = now()) {
    if (typeof id !== 'string' || !id) return
    const s = session(id)
    s.at = Math.max(s.at, Number.isFinite(at) ? Math.min(at, now()) : now())
    state.lastEventAt = Math.max(state.lastEventAt, s.at)
    s.activitySeq++
    if (kind === 'start') {
      if (!s.active) { state.turnStartSeq++; s.turnStartSeq++ }
      s.active = true; s.mode = 'thinking'; s.turnTokens = 0
    } else if (kind === 'end') {
      s.active = false; s.mode = 'idle'
      const terminal = ['completed', 'error', 'interrupted'].includes(data.kind) ? data.kind : 'interrupted'
      if (terminal === 'error') {
        for (const target of [state, s]) {
          target.errors.count++
          target.errors.message = summarizeError(data.error) || '任务执行失败，请查看软件内提示。'
        }
      }
      for (const target of [state, s]) target.turnEnd = { seq: target.turnEnd.seq + 1, kind: terminal,
        ...(terminal === 'error' ? { errorSeq: target.errors.count, reason: target.errors.message } : {}) }
    } else if (kind === 'mode') {
      if (!s.turnStartSeq && !s.turnEnd.seq) s.active = true
      s.mode = data.mode === 'outputting' ? 'outputting' : 'thinking'
      s.talkUntil = s.mode === 'outputting' ? now() + 1800 : 0
    } else if (kind === 'tool') {
      if (data.failed) {
        for (const target of [state, s]) {
          target.tools.fail++
          target.tools.lastFailName = /^[\w .:/-]{1,64}$/.test(data.name || '') ? data.name : undefined
          target.tools.lastFailReason = summarizeError(data.error) || '工具执行失败，请查看软件内提示。'
        }
      } else { state.tools.ok++; s.tools.ok++ }
    } else if (kind === 'question' || kind === 'answer') {
      state.userInput = { seq: state.userInput.seq + 1, scene: kind }
      s.userInput = { seq: s.userInput.seq + 1, scene: kind }
    } else if (kind === 'usage' && Number.isSafeInteger(data.total) && data.total >= 0) {
      s.totalTokens = (s.totalTokens || 0) + data.total
      s.turnTokens = (s.turnTokens || 0) + data.total
    }
    if (sessions.size > 250) {
      for (const [key, value] of sessions) if (!value.active && key !== id) { sessions.delete(key); break }
    }
  }
  function seed(id, active, at = 0) {
    const s = session(id)
    s.active = Boolean(active); s.mode = active ? 'thinking' : 'idle'
    if (Number.isFinite(at)) s.at = Math.max(s.at, Math.min(at, now()))
  }
  const work = s => ({ active: Boolean(s?.active), mode: s?.active ? s.mode === 'outputting' && s.talkUntil > now() ? 'outputting' : 'thinking' : 'idle' })
  const usage = s => s?.totalTokens == null ? null : { total: s.totalTokens, turn: s.turnTokens ?? null }
  return { event, seed, remove: id => sessions.delete(id), snapshot() {
    const all = [...sessions.values()]
    const selected = all.sort((a, b) => b.at - a.at)[0]
    return structuredClone({ ...state,
      work: work(selected),
      closureCompanion: { quota: [], tokenUsage: usage(selected) },
      conversations: all.map(s => ({ id: s.id, lastActivityAt: s.at, activitySeq: s.activitySeq, work: work(s),
        tools: s.tools, errors: s.errors, userInput: s.userInput, turnStartSeq: s.turnStartSeq, turnEnd: s.turnEnd,
        closureCompanion: { tokenUsage: usage(s) } })),
    })
  } }
}

module.exports = { createLinkedState }
