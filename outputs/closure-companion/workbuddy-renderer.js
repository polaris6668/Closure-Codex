// Executed only in the installed WorkBuddy main renderer. No UI changes.
(() => {
  if (window.__closureCompanionBridge?.version === 2) return true
  window.__closureCompanionBridge?.dispose()
  const wb = window.wb
  if (!wb?.conversations?.on || !wb?.on) return false
  const events = [], sessions = new Map(), tools = new Set(), questions = new Set(), modes = new Map(), disposers = []
  let sequence = 0, stopped = false, accountRevision = 0, leaseAt = Date.now()
  const instance = crypto.randomUUID()
  const active = state => ['planning', 'working', 'pending'].includes(state)
  const emit = (id, kind, data = {}) => {
    if (stopped || typeof id !== 'string') return
    if (kind === 'mode') {
      const previous = modes.get(id)
      if (previous?.mode === data.mode && Date.now() - previous.at < 700) return
      modes.set(id, { mode: data.mode, at: Date.now() })
    }
    const at = Date.now()
    const current = sessions.get(id)
    if (current) current.lastActivityAt = at
    events.push({ seq: ++sequence, id, kind, data, at })
    if (events.length > 1200) events.splice(0, events.length - 1200)
  }
  function info(value, initial = false) {
    if (!value?.id || value.visibility === 'hidden' || value.parentConversationId || value.origin === 'subagent') return
    if (value.transport && value.transport !== 'local') return
    const state = value.state
    if (typeof state !== 'string') return
    const previous = sessions.get(value.id)
    sessions.set(value.id, { id: value.id, state, lastActivityAt: value.lastActivityAt ?? previous?.lastActivityAt ?? value.updatedAt ?? 0 })
    if (initial || previous?.state === state) return
    if (active(state) && !active(previous?.state)) emit(value.id, 'start')
    else if (previous && active(previous.state) && !active(state)) emit(value.id, 'end', {
      kind: ['error', 'failed'].includes(state) ? 'error' : state === 'terminated' ? 'interrupted' : 'completed',
    })
  }
  function chunk(id, requestId, messageId, value) {
    if (!value || typeof value !== 'object') return
    const type = value.sessionUpdate || value.type
    if (type === 'agent_message_chunk') emit(id, 'mode', { mode: 'outputting' })
    else if (type === 'agent_thought_chunk') emit(id, 'mode', { mode: 'thinking' })
    if (type === 'tool_call' || type === 'tool_call_update') {
      const key = `${id}:${value.toolCallId || messageId}`
      const status = String(value.status || '').toLowerCase()
      if (type === 'tool_call' && !tools.has(key)) emit(id, 'mode', { mode: 'thinking' })
      if (['completed', 'success', 'succeeded', 'done', 'failed', 'error', 'failure'].includes(status) && !tools.has(key)) {
        tools.add(key)
        emit(id, 'tool', { failed: ['failed', 'error', 'failure'].includes(status) })
      }
      const name = value._meta?.['codebuddy.ai/toolName'] || value.name || value.title || ''
      if (/^(?:AskUserQuestion|ask_user_question|ask_user|request_user_input)$/i.test(name) || questions.has(key)) {
        if (!questions.has(key) && !tools.has(key)) { questions.add(key); emit(id, 'question') }
        else if (questions.has(key) && tools.has(key)) { questions.delete(key); emit(id, 'answer') }
      }
      if (tools.size > 1500) tools.delete(tools.values().next().value)
    }
  }
  disposers.push(wb.conversations.on('requestUpdated', chunk))
  disposers.push(wb.on('wb:conversation:permission', value => {
    if (value.permission?.category !== 'question' || !value.permission.id) return
    const key = `${value.conversationId}:${value.permission.id}`
    if (!questions.has(key)) { questions.add(key); emit(value.conversationId, 'question') }
  }))
  disposers.push(wb.on('wb.account.changed', () => { accountRevision++ }))
  disposers.push(wb.on('wb:conversation:stateChange', value => info({ id: value.conversationId, state: value.to })))
  disposers.push(wb.on('wb:conversation:infoChange', value => info(value.info)))
  disposers.push(wb.on('wb:conversations:listChanged', value => {
    for (const v of value.added || []) info(v)
    for (const v of value.updated || []) info(v)
    for (const v of value.deleted || []) sessions.delete(typeof v === 'string' ? v : v.id)
  }))
  disposers.push(wb.on('wb:conversations:listProgress', value => {
    if (value.space === 'local') for (const v of value.list?.items || []) info(v)
  }))
  // Acquire the native collection feed, including tasks outside the selected chat.
  disposers.push(wb.conversations.onConversationChanged('*', () => {}))
  let loading = false
  async function refresh(initial = false) {
    if (loading || stopped) return
    loading = true
    try {
      const list = await wb.conversations.listScope('local', { page: 1, size: 100 })
      if (!stopped) for (const value of list?.items || []) info(value, initial)
    } catch { /* A disconnected host will be retried. */ }
    finally { loading = false }
  }
  const timer = setInterval(() => {
    if (Date.now() - leaseAt > 18000) window.__closureCompanionBridge?.dispose()
    else void refresh()
  }, 10000)
  void refresh(true)
  window.__closureCompanionBridge = {
    version: 2,
    snapshot() { leaseAt = Date.now(); return { instance, sequence, accountRevision, sessions: [...sessions.values()], events: events.slice() } },
    dispose() {
      stopped = true; clearInterval(timer)
      for (const off of disposers) if (typeof off === 'function') off()
      delete window.__closureCompanionBridge
    },
  }
  return true
})()
