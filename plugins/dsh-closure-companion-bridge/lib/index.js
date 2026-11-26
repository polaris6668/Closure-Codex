import { mkdir, readFile, rename, writeFile, unlink } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import model from './linked-state.cjs'

export const name = 'dsh-closure-companion-bridge'
export const inject = ['sessions', 'agents', 'deepseekAccount']

export function apply(ctx, config = {}) {
  const root = config.directory || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.local/share'), 'ClosureCompanion/bridges')
  const target = path.join(root, 'dsh.json')
  const request = path.join(root, 'dsh-request.json')
  const instance = randomUUID()
  let store = model.createLinkedState()
  let enabled = false, stopped = false, busy = false, lastBalance = 0, balanceBusy = false, generation = 0
  let balance = { status: 'checking', wallets: [], bonusWallets: [] }
  const toolCalls = new Map()
  const top = session => session && session.header?.origin !== 'subagent'
  const answered = message => Array.isArray(message?.content) && message.content.some(block => {
    if (block.type !== 'text' || typeof block.text !== 'string' || block.text.length > 256 * 1024) return false
    try { const result = JSON.parse(block.text); return result.pending !== true && Array.isArray(result.answers) }
    catch { return false }
  })
  const listen = (event, fn) => ctx.on(event, (...args) => {
    if (!enabled || stopped) return
    try { fn(...args) } catch { /* Observers must never interrupt an agent. */ }
  })

  listen('session/event', (session, event) => {
    if (!top(session)) return
    const d = event.data || {}, id = session.id
    if (event.type === 'turn/start') store.event(id, 'start')
    else if (event.type === 'turn/end') {
      const kind = d.reason?.kind === 'completed' ? 'completed' : d.reason?.kind === 'error' ? 'error' : 'interrupted'
      store.event(id, 'end', { kind, error: d.reason?.error }); lastBalance = 0
    } else if (event.type === 'tool/call') {
      store.event(id, 'mode', { mode: 'thinking' })
      toolCalls.set(d.callId, d.name)
      if (/^(ask_user_question|ask_user_question_async|request_user_input)$/.test(d.name)) store.event(id, 'question')
      if (toolCalls.size > 500) toolCalls.delete(toolCalls.keys().next().value)
    } else if (event.type === 'tool/result') {
      const name = toolCalls.get(d.message?.toolCallId)
      toolCalls.delete(d.message?.toolCallId)
      store.event(id, 'tool', { failed: d.message?.isError === true, name, error: d.error?.reason || d.error })
      if (/^(ask_user_question|ask_user_question_async|request_user_input)$/.test(name) && !d.message?.isError && answered(d.message)) store.event(id, 'answer')
    } else if (event.type === 'user/message' && d.source?.kind === 'user-question-reply' && d.source.outcome === 'answered') {
      store.event(id, 'answer')
    } else if (event.type === 'assistant/message' && d.usage) {
      const total = d.usage.totalTokens ?? (d.usage.inputTokens + d.usage.outputTokens)
      store.event(id, 'usage', { total })
    }
  })
  listen('agent/assistant-stream', ({ agent, frame }) => {
    if (!top(agent?.session)) return
    if (frame.type === 'chunk' && frame.chunk?.type === 'text-delta') store.event(agent.id, 'mode', { mode: 'outputting' })
    else if (frame.type === 'start' || frame.type === 'end') store.event(agent.id, 'mode', { mode: 'thinking' })
  })
  listen('session/disposed', session => store.remove(session.id))
  for (const event of ['deepseek-account/signed-out', 'deepseek-account/session-expired']) {
    ctx.on(event, () => { balance = { status: 'signed-out', wallets: [], bonusWallets: [] }; lastBalance = 0 })
  }

  async function tick() {
    if (stopped || busy) return
    busy = true
    try {
      const intent = await readFile(request, 'utf8').then(JSON.parse).catch(() => null)
      const following = intent?.enabled === true && Date.now() - intent.updatedAt < 18000 && intent.updatedAt <= Date.now() + 5000
      if (following !== enabled) {
        enabled = following; generation++; store = model.createLinkedState(); toolCalls.clear(); lastBalance = 0
        balance = { status: 'checking', wallets: [], bonusWallets: [] }
        for (const agent of ctx.agents.list()) if (top(agent.session)) store.seed(agent.id, agent.status === 'running')
      }
      if (!enabled) return
      if (!balanceBusy && Date.now() - lastBalance >= 60000) {
        balanceBusy = true
        lastBalance = Date.now()
        const began = generation
        Promise.resolve().then(() => ctx.deepseekAccount.getBalance({ version: '0.1.2', locale: 'zh-CN', timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60 }))
          .then(value => {
            if (stopped || !enabled || began !== generation) return
            balance = value?.status === 'ready' ? { status: 'ready', wallets: value.value, bonusWallets: value.bonusWallets }
              : { status: value === null ? 'signed-out' : 'unavailable', wallets: [], bonusWallets: [] }
          }).catch(() => { if (began === generation) balance = { status: 'unavailable', wallets: [], bonusWallets: [] } })
          .finally(() => { balanceBusy = false })
      }
      if (stopped) return
      await mkdir(root, { recursive: true })
      const temp = `${target}.${instance}.tmp`
      await writeFile(temp, JSON.stringify({ version: 1, host: 'dsh', instance, pid: process.pid, updatedAt: Date.now(), state: store.snapshot(), balance }), { mode: 0o600 })
      await rename(temp, target)
    } catch { /* A missing desktop pet or a locked state file is harmless. */ }
    finally { busy = false }
  }
  const timer = setInterval(tick, 1000)
  timer.unref?.()
  void tick()
  ctx.effect(() => async () => {
    stopped = true; enabled = false; generation++; clearInterval(timer)
    const current = await readFile(target, 'utf8').then(JSON.parse).catch(() => null)
    if (current?.instance === instance) await unlink(target).catch(() => {})
  })
}
