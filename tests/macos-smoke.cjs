// Run with the official Apple Silicon Electron executable. Profiles and rollouts are temporary.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { setTimeout: delay } = require('node:timers/promises')
const { app, BrowserWindow } = require('electron')

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'closure-macos-smoke-'))
process.env.CODEX_HOME = fixture
process.env.CLOSURE_STATE_DIR = path.join(fixture, 'profile')
const now = new Date()
const date = [now.getFullYear(), now.getMonth() + 1, now.getDate()].map((part) => String(part).padStart(2, '0'))
const folder = path.join(fixture, 'sessions', ...date)
const olderFolder = path.join(fixture, 'sessions', '2021', '01', '01')
fs.mkdirSync(folder, { recursive: true })
fs.mkdirSync(olderFolder, { recursive: true })

function record(payload, type = 'event_msg') {
  return JSON.stringify({ timestamp: new Date().toISOString(), type, payload }) + '\n'
}

function append(chat, ...lines) {
  fs.appendFileSync(path.join(folder, `rollout-${chat}.jsonl`), lines.join(''))
}

function metadata(originator = 'Codex Desktop', parent_thread_id) {
  return record({ originator, source: 'vscode', parent_thread_id }, 'session_meta')
}

function turn(type, turn_id, extra = {}) {
  return record({ type, turn_id, ...extra })
}

async function waitFor(label, check, timeout = 12000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const value = await check()
    if (value) return value
    await delay(70)
  }
  throw new Error(`Timed out: ${label}`)
}

append('history', metadata(), turn('task_started', 'history'), turn('task_complete', 'history'))
const resumed = path.join(olderFolder, 'rollout-resumed.jsonl')
fs.writeFileSync(resumed, [metadata(), turn('task_started', 'previous'), turn('task_complete', 'previous')]
  .map((line) => line.replace(/"timestamp":"[^"]+"/, '"timestamp":"2021-01-01T00:00:00Z"')).join(''))
require(process.env.CLOSURE_TEST_APP || '../outputs/closure-companion/main.cjs')

async function run() {
  await app.whenReady()
  const win = await waitFor('desktop window', () => BrowserWindow.getAllWindows().find((window) => window.isVisible()))
  win.webContents.setAudioMuted(true)
  const read = (expression) => win.webContents.executeJavaScript(expression)
  const state = () => read("fetch('/dsh-closure/state').then(r => r.json())")
  const inspect = () => read(`(() => {
    const pet = window.__dshClosurePet
    const bubble = document.querySelector('#dsh-closure-pet-bubble')
    const panel = document.querySelector('#dsh-closure-pet-settings')
    return { phase: pet?.phase, voice: pet?.voice, layers: pet?.layers, animation:pet?.animation,
      bubble: bubble?.style.opacity === '1' ? bubble.textContent : null, panelOpen: panel?.style.display === 'block' }
  })()`)
  const completionVoice = async () => {
    const current = await inspect()
    if (!current.voice) return null
    const valid = await read(`import('/dsh-closure/src/core/dialogue.js').then(({ DEFAULT_VOICE_QUEUES }) =>
      DEFAULT_VOICE_QUEUES.completion.includes(${JSON.stringify(current.voice.id)}))`)
    return valid ? current : null
  }

  await waitFor('Spine renderer', async () => (await inspect()).phase === 'running')
  assert.equal(win.isAlwaysOnTop(), true)
  assert.equal((await state()).closureCompanion.following, true)
  assert.deepEqual((await state()).turnEnds, [])
  assert.equal((await inspect()).voice, null)
  await read(`import('/dsh-closure/src/core/settings.js').then(({settings}) => {
    settings.voiceQueueMode = 'personal'
    settings.voiceQueues = {...settings.voiceQueues, start:['a18'], completion:['b01','b05']}
    settings.quotaReminderMinutes = 0
  })`)
  const petPoint = await read(`(() => {
    const pet = window.__dshClosurePet
    const host = document.querySelector('#dsh-closure-pet')
    const point = host.getBoundingClientRect()
    for (let y = point.top; y < point.bottom; y += 3) {
      for (let x = point.left; x < point.right; x += 3) if (pet.hitTest(x, y)) return { clientX: x, clientY: y }
    }
    return null
  })()`)
  assert.ok(petPoint, 'click hit mask exists in the desktop window')
  const rightClickPet = () => read(`document.dispatchEvent(new MouseEvent('contextmenu', {
    ...${JSON.stringify(petPoint)}, button: 2, bubbles: true, cancelable: true,
  }))`)

  append('child', metadata('Codex Desktop', 'parent'), turn('task_started', 'child'), turn('task_complete', 'child'))
  append('cli', metadata('codex_cli_rs'), turn('task_started', 'cli'), turn('task_complete', 'cli'))
  append('first', metadata(), turn('task_started', 'first'))
  await waitFor('Japanese start voice from personal queue', async () => {
    const current = await inspect()
    return current.voice?.id === 'a18' && current.voice.language === 'ja' && current.layers?.work === 'Special_B'
  })
  await read(`import('/dsh-closure/src/core/settings.js').then(({settings}) => { settings.voiceQueues.start = [] })`)
  append('second', metadata(), turn('task_started', 'second'))
  await delay(30)
  append('ongoing', metadata(), turn('task_started', 'ongoing'),
    turn('token_count', 'ongoing', { info: { total_token_usage: { total_tokens: 1234 }, last_token_usage: { total_tokens: 234 } } }))
  await waitFor('working animation', async () => (await inspect()).layers?.work === 'Special_B')
  await waitFor('token usage from active chat', async () => (await state()).closureCompanion.tokenUsage?.total === 1234)

  // An output record larger than upstream's tail limit must not hide a terminal event.
  append('first', turn('task_complete', 'first'), record({ type: 'output', size: 'x'.repeat(400000) }, 'response_item'))
  append('second', turn('task_complete', 'second'))
  await waitFor('both terminal events', async () => (await state()).turnEnds.length === 2)
  const first = await waitFor('first Japanese completion voice', completionVoice)
  assert.equal(first.voice.language, 'ja')
  assert.equal(await rightClickPet(), false, 'right-click on the pet is consumed during speech')
  const stopped = await inspect()
  assert.equal(stopped.voice, null, 'right-click stops the current voice')
  assert.equal(stopped.panelOpen, false, 'stopping a voice does not open settings')
  await rightClickPet()
  assert.equal((await inspect()).panelOpen, true, 'right-click while quiet opens settings')
  await read('window.__dshClosurePet.closePanel()')
  const second = await waitFor('second Japanese voice', async () => {
    const current = await completionVoice()
    if (current?.voice.id !== first.voice.id) return current
  }, 35000)
  assert.equal(second.voice.language, 'ja')
  assert.deepEqual(new Set([first.voice.id, second.voice.id]), new Set(['b01', 'b05']))
  const lines = await read(`import('/dsh-closure/src/core/dialogue.js').then(({ dialogue, DEFAULT_VOICE_QUEUES }) =>
    ${JSON.stringify([first.voice.id, second.voice.id])}.map((id) => DEFAULT_VOICE_QUEUES.completion.includes(id) && dialogue[id][1]))`)
  assert.ok(lines.every(Boolean))
  const withoutWrapping = (text) => text.replace(/\n/g, '')
  assert.equal(withoutWrapping(first.bubble), withoutWrapping(lines[0]))
  assert.equal(withoutWrapping(second.bubble), withoutWrapping(lines[1]))
  await waitFor('work resumes after both clips', async () => {
    const current = await inspect()
    return !current.voice && current.layers?.work === 'Special_B' && !current.layers.overlay
  }, 35000).catch(async (error) => { console.error({ renderer: await inspect(), activity: await state() }); throw error })
  assert.deepEqual((await state()).closureCompanion.tokenUsage, { total: 1234, turn: 234 })

  await read(`(() => {
    window.__dshClosurePet.openPanel()
    const panel = document.querySelector('#dsh-closure-pet-settings')
    const usage = [...panel.querySelectorAll('button')].find(button => button.textContent === '查看用量')
    if (!usage || !panel.querySelector('#dsh-closure-voice-queues') || !panel.querySelector('[data-theme-action="enable"]')) throw new Error('Missing extended desktop controls')
    usage.click()
  })()`)
  await waitFor('token usage bubble', async () => {
    if ((await inspect()).bubble?.includes('234 Token')) return true
    await read(`Array.from(document.querySelectorAll('#dsh-closure-pet-settings button')).find(button => button.textContent === '查看用量')?.click()`)
    return false
  })

  append('ongoing', turn('turn_aborted', 'ongoing', { reason: 'interrupted' }))
  const interrupted = await waitFor('silent interruption bubble', async () => {
    const current = await inspect()
    if (current.bubble?.includes('停下了')) return current
  })
  assert.equal(interrupted.voice, null)
  assert.equal(interrupted.layers.work, null)

  append('failed', metadata(), turn('task_started', 'failed'),
    turn('task_complete', 'failed', { error: { message: 'fixture' } }))
  const failed = await waitFor('silent error bubble', async () => {
    const current = await inspect()
    if (current.bubble?.includes('出错了')) return current
  })
  assert.equal(failed.voice, null)
  fs.appendFileSync(resumed, turn('task_started', 'new') + turn('task_complete', 'new'))
  const finished = await waitFor('resumed old chat', async () => {
    const snapshot = await state()
    return snapshot.turnEnds.length >= 5 && snapshot
  })
  assert.deepEqual(finished.turnEnds.map(({ kind }) => kind), ['completed', 'completed', 'interrupted', 'error', 'completed'])

  app.once('before-quit', () => console.log('macOS smoke passed: visible pet, main-chat filtering, Japanese personal queue and rotation with captions, sequential playback, token usage, extended controls, silent failure/interruption, resumed chat, right-click exit'))
  await read(`(() => {
    window.__dshClosurePet.openPanel()
    const button = [...document.querySelectorAll('#dsh-closure-pet-settings button')].find((item) => item.textContent === '退出桌宠')
    if (!button) throw new Error('Missing quit action')
    setTimeout(() => button.click(), 200)
  })()`)
  await delay(2000)
  throw new Error('Right-click quit did not exit')
}

app.once('quit', () => fs.rmSync(fixture, { recursive: true, force: true }))
run().catch((error) => { console.error(error); app.exit(1) })
