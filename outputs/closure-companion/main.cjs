const { app, BrowserWindow, dialog, ipcMain, protocol, screen, session } = require('electron')
const { spawn, execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { mkdtempSync, rmSync } = require('node:fs')
const { mkdir, readFile, rename, writeFile } = require('node:fs/promises')
const readline = require('node:readline')
const path = require('node:path')
const os = require('node:os')
const { createActivity } = require('./activity.cjs')
const { createQuota } = require('./quota.cjs')
const { createRuntimeController } = require('./runtime-settings.cjs')

const scheme = 'closure-pet'
const origin = `${scheme}://local`
const demo = process.argv.includes('--demo')
const smoke = process.argv.includes('--smoke')
const canvas = process.argv.includes('--canvas')
const dev = demo || smoke
const macOS = process.platform === 'darwin'
const macPort = macOS && !dev
const { followMacCodex, macStartupSetting, watchMacPointerAvoidance } = macPort ? require('./mac-runtime.cjs') : {}
const smokeProfile = smoke && !process.env.CLOSURE_STATE_DIR
  ? mkdtempSync(path.join(os.tmpdir(), 'closure-smoke-')) : null
const profile = process.env.CLOSURE_STATE_DIR || smokeProfile || (macOS
  ? path.join(app.getPath('appData'), 'Closure Companion') : path.join(__dirname, '.closure-profile'))
const assets = path.join(__dirname, 'upstream', 'assets')
const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex')
const powershell = process.platform === 'win32'
  ? path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') : null
const autostart = path.resolve(__dirname, '../closure-autostart')
const runFile = promisify(execFile)
app.setName('Closure Companion')
app.setPath('userData', profile)
app.setPath('sessionData', path.join(profile, 'chromium'))
if (smokeProfile) app.once('quit', () => {
  try { rmSync(smokeProfile, { recursive: true, force: true }) } catch (error) {
    console.error('Closure smoke profile cleanup:', error.message)
  }
})
app.commandLine.appendSwitch('disable-background-networking')
app.commandLine.appendSwitch('disable-component-update')
protocol.registerSchemesAsPrivileged([{ scheme, privileges: { standard: true, secure: true, supportFetchAPI: true } }])

const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.atlas': 'text/plain; charset=utf-8',
  '.png': 'image/png', '.ogg': 'audio/ogg', '.woff2': 'font/woff2',
}
const staticPaths = { '/': 'index.html', '/bridge.js': 'bridge.js' }

function registerProtocol(getActivityState) {
  protocol.handle(scheme, async (request) => {
    const url = new URL(request.url)
    if (url.hostname !== 'local') return new Response(null, { status: 404 })
    if (url.pathname === '/dsh-closure/crt') return new Response(null, { status: 410 })
    if (url.pathname === '/dsh-closure/config' && request.method === 'PUT') return new Response(null, { status: 204 })
    if (request.method !== 'GET') return new Response(null, { status: 405 })
    if (url.pathname === '/dsh-closure/state') {
      return Response.json(getActivityState())
    }
    if (url.pathname === '/dsh-closure/config') return Response.json({})

    let file
    if (Object.hasOwn(staticPaths, url.pathname)) {
      file = path.join(__dirname, staticPaths[url.pathname])
    } else {
      const src = url.pathname.match(/^\/dsh-closure\/(?:assets\/)?((?:src|spine|vendor|audio|fonts)\/[a-z0-9/_-]+\.[a-z0-9]+)$/i)
      if (!src || !Object.hasOwn(mime, path.extname(src[1]))) return new Response(null, { status: 404 })
      file = path.join(assets, src[1])
    }
    try {
      return new Response(await readFile(file), { headers: { 'content-type': mime[path.extname(file)] } })
    } catch {
      return new Response(null, { status: 404 })
    }
  })
}

function followCodex(win, report, onLost) {
  const powershell = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const handle = win.getNativeWindowHandle()
  const overlayHandle = handle.length === 8 ? handle.readBigUInt64LE() : handle.readUInt32LE()
  const tracker = spawn(powershell, [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'follow-codex.ps1'),
    '-OverlayHandle', String(overlayHandle),
  ], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const lines = readline.createInterface({ input: tracker.stdout })
  let stopped = false
  lines.on('line', (message) => {
    if (stopped || win.isDestroyed()) return
    try {
      const { visible, x, y, width, height } = JSON.parse(message)
      report(visible ? { x, y, width, height } : null)
    } catch (error) {
      console.error('Closure window tracker:', error.message)
    }
  })
  tracker.stderr.on('data', (chunk) => console.error(chunk.toString()))
  tracker.on('error', (error) => console.error('Closure window tracker:', error.message))
  tracker.once('close', () => {
    if (!stopped && !win.isDestroyed()) onLost()
  })
  return () => {
    stopped = true
    lines.close()
    tracker.kill()
  }
}

async function startupSetting(enabled) {
  const args = ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', path.join(autostart, 'Configure.ps1')]
  if (enabled === undefined) args.push('-Status')
  else {
    args.push('-RegistrationOnly')
    if (!enabled) args.push('-Disable')
  }
  const { stdout } = await runFile(powershell, args, { windowsHide: true, timeout: 15000 })
  return enabled === undefined ? JSON.parse(stdout.trim()).startAtLogin : enabled
}

function startWatcher() {
  const child = spawn(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', path.join(autostart, 'Watch-Codex.ps1'), '-Refresh'], {
    windowsHide: true, detached: true, stdio: 'ignore',
  })
  child.on('error', (error) => console.error('Closure lifecycle:', error.message))
  child.unref()
}

function managePetWindow(win, macMode = false) {
  let showOutsideCodex = true
  let desktopDisplay
  let codexBounds
  let stopTracker
  let ready = false
  let loaded = false

  function syncWindow() {
    if (win.isDestroyed()) return
    let bounds
    if (showOutsideCodex) {
      const display = screen.getAllDisplays().find(({ id }) => id === desktopDisplay) || screen.getPrimaryDisplay()
      desktopDisplay = display.id
      bounds = display.workArea
    } else if (codexBounds) {
      bounds = macMode ? codexBounds : screen.screenToDipRect(null, codexBounds)
    }
    if (bounds) win.setBounds(bounds)
    if (ready && bounds) {
      if (!win.isVisible()) win.showInactive()
    } else if (win.isVisible()) {
      win.hide()
    }
  }

  const displayEvents = ['display-metrics-changed', 'display-added', 'display-removed']
  displayEvents.forEach((event) => screen.on(event, syncWindow))
  win.once('closed', () => {
    displayEvents.forEach((event) => screen.removeListener(event, syncWindow))
    stopTracker?.()
  })

  const setShowOutsideCodex = async (enabled) => {
    stopTracker?.()
    if (enabled) {
      const display = loaded && win.isVisible()
        ? screen.getDisplayMatching(win.getBounds()) : screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
      desktopDisplay = display.id
    }
    showOutsideCodex = enabled
    codexBounds = null
    if (!showOutsideCodex) {
      let cancelled = false
      let retry
      let stop
      const track = () => {
        const report = (bounds) => {
          codexBounds = bounds
          syncWindow()
        }
        const onLost = () => {
          codexBounds = null
          syncWindow()
          // Recover a failed tracker independently of the pet process.
          if (!cancelled) retry = setTimeout(track, 1000)
        }
        stop = macMode ? followMacCodex(report, onLost) : followCodex(win, report, onLost)
      }
      stopTracker = () => { cancelled = true; clearTimeout(retry); stop?.() }
      track()
    } else {
      stopTracker = undefined
    }
    syncWindow()
  }
  const setLinked = async (enabled) => {
    const query = new URLSearchParams()
    if (canvas) query.set('canvas', '1')
    if (macMode) query.set('macOS', '1')
    query.set('codexLinked', String(enabled))
    await win.loadURL(`${origin}/?${query}`)
    loaded = true
    ready = true
    syncWindow()
  }
  return { setLinked, setShowOutsideCodex }
}

function registerInput(win) {
  let interactive = false
  let petTarget = false
  let controlsActive = false
  let avoid = macPort
  let timer
  win.setIgnoreMouseEvents(true)
  function syncInput() {
    const enabled = controlsActive || (petTarget && !avoid)
    if (win.isDestroyed() || enabled === interactive) return
    interactive = enabled
    win.setIgnoreMouseEvents(!enabled)
  }
  function reportInput(event, target, controls) {
    if (win.isDestroyed() || event.sender !== win.webContents) return
    petTarget = target === true
    controlsActive = controls === true
    syncInput()
  }
  ipcMain.on('closure:interactive', reportInput)
  win.webContents.on('did-finish-load', () => {
    petTarget = controlsActive = false
    syncInput()
  })
  function pollCursor() {
    if (win.isDestroyed() || !win.isVisible()) return
    const pointer = screen.getCursorScreenPoint()
    const bounds = win.getContentBounds()
    win.webContents.send('closure:cursor', { x: pointer.x - bounds.x, y: pointer.y - bounds.y, avoid })
  }
  const stopAvoidance = watchMacPointerAvoidance?.((enabled) => {
    avoid = enabled
    syncInput()
    pollCursor()
  })
  function stopPolling() {
    clearInterval(timer)
    timer = undefined
  }
  win.on('show', () => {
    if (timer) return
    pollCursor()
    timer = setInterval(pollCursor, 24)
  })
  win.on('hide', stopPolling)
  win.once('closed', () => {
    stopPolling()
    stopAvoidance?.()
    ipcMain.removeListener('closure:interactive', reportInput)
  })
}

function registerExit(win) {
  ipcMain.on('closure:quit', (event) => {
    if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) return
    app.quit()
  })
}

function registerRuntimeSettings(win, runtime) {
  const trusted = (event) => event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame
  ipcMain.handle('closure:runtime-settings', async (event) => {
    if (!trusted(event)) return null
    return runtime.refresh()
  })
  ipcMain.handle('closure:set-runtime-setting', (event, key, enabled) => {
    if (!trusted(event)) return { ok: false, error: '无法修改此设置。' }
    return runtime.update(key, enabled)
  })
}

function registerMacTheme(win) {
  const { clipboard } = require('electron')
  const theme = require('./mac-theme.cjs').createMacTheme(clipboard)
  ipcMain.handle('closure:theme-action', async (event, name) => {
    if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) return null
    return theme.action(name)
  })
  app.once('before-quit', (event) => {
    if (!theme.isRunning()) return
    event.preventDefault()
    theme.stop().finally(() => app.quit())
  })
}

async function runRuntimeSmoke(win) {
  const waitFor = async (source) => {
    for (let n = 0; n < 100; n++) {
      if (await win.webContents.executeJavaScript(source)) return
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    throw new Error(`Runtime settings check timed out: ${source}`)
  }
  await waitFor(`window.__dshClosurePet?.phase === 'running'`)
  await win.webContents.executeJavaScript('window.__dshClosurePet.openPanel()')
  const selector = (label) => `document.querySelector('input[aria-label="${label}"]')`
  await waitFor(`${selector('开机自启')}?.checked && !${selector('开机自启')}.disabled`)
  await win.webContents.executeJavaScript(`${selector('开机自启')}.click()`)
  await waitFor(`!${selector('开机自启')}.disabled && !${selector('开机自启')}.checked`)
  await waitFor(`${selector('在桌面和其他软件中显示')}?.checked && ${selector('Codex 联动')}.checked`)
  await win.webContents.executeJavaScript(`${selector('在桌面和其他软件中显示')}.click()`)
  await waitFor(`!${selector('在桌面和其他软件中显示')}.disabled && !${selector('在桌面和其他软件中显示')}.checked && ${selector('Codex 联动')}.checked`)
  await win.webContents.executeJavaScript(`${selector('Codex 联动')}.click()`)
  await waitFor(`location.search.includes('codexLinked=false') && window.__dshClosurePet?.phase === 'running'`)
  await win.webContents.executeJavaScript('window.__dshClosurePet.openPanel()')
  await waitFor(`${selector('Codex 联动')} && !${selector('Codex 联动')}.disabled && !${selector('Codex 联动')}.checked`)
  await waitFor(`!${selector('在桌面和其他软件中显示')}.checked`)
  await win.webContents.executeJavaScript(`${selector('在桌面和其他软件中显示')}.click()`)
  await waitFor(`!${selector('在桌面和其他软件中显示')}.disabled && ${selector('在桌面和其他软件中显示')}.checked && !${selector('Codex 联动')}.checked`)
  const unlinked = await win.webContents.executeJavaScript(`(async () => {
    const panel = document.querySelector('#dsh-closure-pet-settings')
    const runtime = await window.closureCompanion.getRuntimeSettings()
    const headings = [...panel.querySelectorAll('summary')].map((item) => item.textContent)
    return getComputedStyle(panel).display === 'block' && !runtime.codexLinked && runtime.showOutsideCodex && !runtime.startAtLogin && !panel.textContent.includes('运行模式') &&
      !panel.textContent.includes('独立桌面') && !headings.includes('CRT 显示效果') &&
      !headings.includes('提醒与播报') && !panel.querySelector('[data-scene]')
  })()`)
  if (!unlinked) throw new Error('Unlinked desktop controls did not update')
  if (process.env.CLOSURE_RUNTIME_SMOKE_PNG) {
    await new Promise((resolve) => setTimeout(resolve, 250))
    await writeFile(process.env.CLOSURE_RUNTIME_SMOKE_PNG, (await win.webContents.capturePage()).toPNG())
  }
  await win.loadURL(win.webContents.getURL())
  await waitFor(`window.__dshClosurePet?.phase === 'running'`)
  await win.webContents.executeJavaScript('window.__dshClosurePet.openPanel()')
  await waitFor(`${selector('开机自启')} && !${selector('开机自启')}.disabled && !${selector('开机自启')}.checked`)
  await win.webContents.executeJavaScript(`${selector('Codex 联动')}.click()`)
  await waitFor(`location.search.includes('codexLinked=true') && window.__dshClosurePet?.phase === 'running'`)
  const linkedDesktop = await win.webContents.executeJavaScript(`window.closureCompanion.getRuntimeSettings().then((settings) =>
    settings.codexLinked && settings.showOutsideCodex && !settings.startAtLogin)`)
  if (!linkedDesktop) throw new Error('Activity linkage changed desktop display or startup')
  console.log(JSON.stringify({ runtimeCheckboxes: true, startupIndependent: true, outsideCodexIndependent: true, linkedAndUnlinkedReload: true }))
}

async function runSmoke(win) {
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const evaluate = (source) => win.webContents.executeJavaScript(source)
  let phase
  for (let n = 0; n < 40; n++) {
    phase = await evaluate('window.__dshClosurePet?.phase')
    if (phase === 'running' || phase === 'failed') break
    await delay(200)
  }
  if (phase !== 'running') throw new Error(`Spine failed to start: ${await evaluate('window.__dshClosurePet?.error') || phase}`)

  const result = await evaluate(`(async () => {
    const pet = window.__dshClosurePet
    const { DEFAULT_VOICE_QUEUES } = await import('/dsh-closure/assets/src/core/dialogue.js')
    const screenPet = document.querySelector('#dsh-closure-pet canvas')
    const hitPoint = () => {
      const bounds = screenPet.getBoundingClientRect()
      for (let y = Math.floor(bounds.top) + 3; y < bounds.bottom; y += 6) {
        for (let x = Math.floor(bounds.left) + 3; x < bounds.right; x += 6) {
          if (pet.hitTest(x, y)) return { x, y }
        }
      }
      throw new Error('Hit mask is empty.')
    }
    const before = screenPet.getBoundingClientRect()
    const point = hitPoint()
    const pointer = (type, x, y) => screenPet.dispatchEvent(new PointerEvent(type, {
      pointerId: 1, pointerType: 'mouse', clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true,
    }))
    pointer('pointerdown', point.x, point.y)
    pointer('pointermove', point.x - 70, point.y - 50)
    pointer('pointerup', point.x - 70, point.y - 50)
    await new Promise((done) => setTimeout(done, 300))
    const after = screenPet.getBoundingClientRect()
    const dragged = after.left < before.left - 30 && after.top < before.top - 25
    pet.resetPosition()
    await new Promise((done) => setTimeout(done, 260))
    const click = (target = point) => {
      pointer('pointerdown', target.x, target.y)
      pointer('pointerup', target.x, target.y)
    }
    const waitFor = async (condition) => {
      for (let attempt = 0; attempt < 50; attempt++) {
        if (await condition()) return true
        await new Promise((done) => setTimeout(done, 20))
      }
      return false
    }
    const quota = [{ minutes: 300, remaining: 85.5 }]
    const tokenUsage = { total: 12480, turn: 900 }
    const state = (mode = 'idle', turnStartSeq = 0, seq = 0, kind = 'completed') => ({
      closureCompanion: { source: 'official', quota, credits: { balance: '3.25' }, tokenUsage },
      work: { mode, active: mode !== 'idle' },
      turnStartSeq, turnEnd: { seq, kind },
    })
    pet.applyState(state())
    click()
    const bubble = document.querySelector('#dsh-closure-pet-bubble')
    const bubbleText = () => bubble.textContent.replace(/\\s+/g, '')
    const clicked = bubble.style.opacity === '1' && bubbleText().length > 0 &&
      !bubbleText().includes('85.5%') && !bubbleText().includes('Token') &&
      await waitFor(() => DEFAULT_VOICE_QUEUES.working.includes(pet.voice?.id))
    pet.applyState({ ...state(), userInput: { seq: 1, scene: 'question' } })
    const questionVoice = await waitFor(() => pet.voice?.id === 'b10') && bubbleText().includes('有晋升的机会')
    const answerVoices = []
    for (let index = 0; index < 5; index++) {
      const previous = pet.voice?.id
      pet.applyState({ ...state(), userInput: { seq: index + 2, scene: 'answer' } })
      await waitFor(() => DEFAULT_VOICE_QUEUES.answer.includes(pet.voice?.id) && pet.voice.id !== previous)
      answerVoices.push(pet.voice?.id)
    }
    const answerRotation = answerVoices.slice(0, 4).sort().join() === 'b12,b13,b14,b15' &&
      DEFAULT_VOICE_QUEUES.answer.includes(answerVoices[4]) && answerVoices[4] !== answerVoices[3]
    pet.hideBubble()
    document.dispatchEvent(new MouseEvent('contextmenu', { clientX: point.x, clientY: point.y, cancelable: true }))
    const settings = document.querySelector('#dsh-closure-pet-settings')
    const panelOpened = getComputedStyle(settings).display === 'block'
    const getSavedSettings = () => JSON.parse(localStorage.getItem('dshcl-settings'))
    const fpsSlider = settings.querySelector('input[type="range"][aria-label="帧率"]')
    const { normalizeSettings } = await import('/dsh-closure/assets/src/shared/protocol.js')
    const fpsRange = fpsSlider.min === '30' && fpsSlider.max === '60' && fpsSlider.step === '1' &&
      fpsSlider.value === '60' && normalizeSettings({ size: 1 }).fps === 60 &&
      normalizeSettings({ fps: 10 }).fps === 30 && normalizeSettings({ fps: 90 }).fps === 60
    fpsSlider.value = '45'
    fpsSlider.dispatchEvent(new Event('input', { bubbles: true }))
    const fpsSliderWorks = fpsRange && fpsSlider.nextElementSibling.textContent === '45 FPS' && getSavedSettings().fps === 45
    const notification = [...settings.querySelectorAll('details')].find((item) => item.querySelector('summary').textContent === '提醒与播报')
    notification.open = true
    const quotaOption = notification.querySelector('button[data-minutes="0"]')
    quotaOption.click()
    const toolNotice = notification.querySelector('input[type=checkbox]')
    toolNotice.click()
    const notificationsSaved = quotaOption.getAttribute('aria-pressed') === 'true' &&
      getSavedSettings().quotaReminderMinutes === 0 && !getSavedSettings().toolFailureNotice

    const editor = settings.querySelector('#dsh-closure-voice-queues')
    editor.querySelector('summary').click()
    const defaultMode = editor.querySelector('[data-queue-mode="default"]')
    const personalMode = editor.querySelector('[data-queue-mode="personal"]')
    const scenes = [...editor.querySelectorAll('[data-scene]')]
    const selectScene = (scene) => editor.querySelector('[data-scene="' + scene + '"]').click()
    const add = (id) => editor.querySelector('[data-add-voice="' + id + '"]').click()
    const remove = (id) => editor.querySelector('[data-queued-voice="' + id + '"] button:last-child').click()
    const list = () => [...editor.querySelectorAll('[data-queued-voice]')].map((row) => row.dataset.queuedVoice)
    const visibleClips = () => editor.querySelectorAll('[data-clip]:not([hidden])').length
    const expectedQueues = {
      start: 'a18,a19,a21,a23,a24',
      working: 'a02,a03,a04,a07,a08,a09,a11,a12,a20,a22,a25,a28,a33,a34,a36,a42,a06,a13,a14,b08',
      completion: 'a01,a05,a17,a29,a30,a44,b01,b02,b03,b04,b05,b07,b09,b18',
      startup: 'a37', idle: 'a10,b16', toolFailure: 'a31,a32',
      question: 'b10', answer: 'b12,b13,b14,b15',
    }
    const defaultQueues = await waitFor(() => defaultMode.getAttribute('aria-pressed') === 'true') &&
      scenes.length === Object.keys(expectedQueues).length && scenes.every((tab) => {
      tab.click()
      return list().join() === expectedQueues[tab.dataset.scene]
    })
    const fullCatalog = visibleClips() === 57
    editor.querySelector('[data-group="b"]').click()
    const filterWorks = visibleClips() === 19
    editor.querySelector('[data-group=""]').click()
    personalMode.click()
    const emptyPersonalQueues = scenes.every((tab) => {
      tab.click()
      return list().length === 0
    })
    selectScene('start')
    defaultMode.click()
    pet.applyState(state('thinking', 1))
    const defaultOverridesPersonal = list().join() === expectedQueues.start &&
      getSavedSettings().voiceQueues.start.length === 0 &&
      editor.querySelector('[data-add-voice="a01"]').disabled &&
      await waitFor(() => DEFAULT_VOICE_QUEUES.start.includes(pet.voice?.id))
    personalMode.click()
    pet.hideBubble()
    pet.applyState(state())
    pet.applyState(state('thinking', 1))
    const emptyDoesNotSpeak = !pet.voice && bubble.style.opacity === '0'

    selectScene('start')
    add('a18')
    add('a19')
    add('a01')
    remove('a01')
    for (const [scene, clip] of Object.entries({ working: 'a23', completion: 'a30', startup: 'b01', idle: 'b03' })) {
      selectScene(scene)
      for (const id of list()) remove(id)
      add(clip)
    }
    selectScene('working')
    add('a34')
    selectScene('start')
    const savedQueues = getSavedSettings().voiceQueues
    const queueEditor = fullCatalog && filterWorks && emptyPersonalQueues && emptyDoesNotSpeak &&
      list().join() === 'a18,a19' && !editor.querySelector('[data-add-voice="a01"]').disabled &&
      editor.querySelector('[data-add-voice="a19"]').disabled &&
      savedQueues.start.join() === 'a18,a19' && savedQueues.working.join() === 'a23,a34' &&
      savedQueues.completion.join() === 'a30' && savedQueues.startup.join() === 'b01' && savedQueues.idle.join() === 'b03'

    const voiceControl = settings.querySelector('[aria-label="角色配音"]')
    const voiceLanguages = [...settings.querySelectorAll('button[data-voice-language]')]
    const defaultVoice = voiceControl.checked && voiceLanguages.find(
      (button) => button.getAttribute('aria-pressed') === 'true')?.dataset.voiceLanguage === 'zh'
    const toolState = (fail) => ({
      ...state('idle', 1),
      tools: { ok: 0, fail, lastFailName: 'web.search', lastFailReason: '请求频率或额度受限（HTTP 429）' },
    })
    pet.play('Idle', true)
    pet.hideBubble()
    pet.applyState(toolState(0))
    pet.applyState(toolState(1))
    const disabledToolNotice = bubble.style.opacity === '0' && !pet.voice
    toolNotice.click()
    defaultMode.click()
    let toolVoice, toolVoiceRotates, toolTextWithoutVoice
    const clock = Date.now
    try {
      const base = clock()
      Date.now = () => base
      pet.applyState(toolState(2))
      toolVoice = await waitFor(() => DEFAULT_VOICE_QUEUES.toolFailure.includes(pet.voice?.id)) &&
        bubbleText().includes('web.search报错了') && bubbleText().includes('HTTP429')
      if (!toolVoice) throw new Error(JSON.stringify({ voice: pet.voice, text: bubbleText(), layers: pet.layers,
        enabled: toolNotice.checked, audioEnabled: voiceControl.checked, hidden: document.hidden, saved: getSavedSettings().voiceQueues.toolFailure }))
      const firstErrorVoice = pet.voice.id
      Date.now = () => base + 1500
      pet.play('Idle', true)
      pet.applyState(toolState(3))
      toolVoiceRotates = await waitFor(() => pet.voice?.id === (firstErrorVoice === 'a31' ? 'a32' : 'a31')) &&
        bubbleText().includes(firstErrorVoice === 'a31' ? '挂钩释放' : '追踪设备')
      personalMode.click()
      Date.now = () => base + 3000
      pet.play('Idle', true)
      pet.applyState(toolState(4))
      toolTextWithoutVoice = !pet.voice && bubbleText().includes('HTTP429') && !bubbleText().includes('挂钩释放')
    } finally {
      Date.now = clock
    }
    toolNotice.click()
    pet.hideBubble()
    pet.play('Idle', true)
    selectScene('start')

    const listen = (id) => editor.querySelector('[data-clip="' + id + '"] button').click()
    let voicesPlayed = 0
    for (const button of voiceLanguages) {
      button.click()
      if (pet.voice) throw new Error('Changing voice language left the previous line playing')
      listen('a18')
      if (await waitFor(() => pet.voice?.language === button.dataset.voiceLanguage)) voicesPlayed++
    }
    listen('b01')
    const languageFallback = await waitFor(() => pet.voice?.language === 'zh' && pet.voice.id === 'b01')
    const voiceVolume = settings.querySelector('input[aria-label="配音音量"]')
    const effectsVolume = settings.querySelector('input[aria-label="音效音量"]')
    const setVolume = (slider, value) => {
      slider.value = value
      slider.dispatchEvent(new Event('input', { bubbles: true }))
    }
    const effectsBefore = pet.sounds.volume
    setVolume(voiceVolume, '0')
    const mutedVoice = pet.voice?.volume === 0
    setVolume(voiceVolume, '0.25')
    const liveVoiceVolume = pet.voice?.volume === 0.25 && pet.sounds.volume === effectsBefore
    setVolume(effectsVolume, '0.5')
    const separateVolumes = pet.sounds.volume === 0.5 && pet.voice?.volume === 0.25
    pet.closePanel()
    const previewStops = !pet.voice
    const voiceVolumeWorks = mutedVoice && liveVoiceVolume && separateVolumes &&
      getSavedSettings().voiceVolume === 0.25 && getSavedSettings().volume === 0.5
    pet.applyState(state('thinking', 2))
    const startVoice = await waitFor(() => ['a18', 'a19'].includes(pet.voice?.id) && pet.voice.language === 'ko')
    const firstStartVoice = pet.voice?.id
    const startText = bubbleText()
    click(hitPoint())
    const clickKeepsDialogue = bubbleText() === startText && pet.voice?.id === firstStartVoice
    pet.applyState(state('thinking', 3))
    const startRotates = await waitFor(() => pet.voice?.id === (firstStartVoice === 'a19' ? 'a18' : 'a19'))
    pet.openPanel()
    voiceControl.click()
    const voiceSettings = defaultVoice && voicesPlayed === 4 && languageFallback && previewStops && !pet.voice &&
      !voiceControl.checked && getSavedSettings().voice === false && getSavedSettings().voiceLanguage === 'ko'
    editor.open = false
    const startupScheduled = pet.startup.pending
    const expressions = [...settings.querySelectorAll('details')].find((item) => item.querySelector('summary').textContent === '预览表情')
    expressions.open = true
    const previewButton = [...settings.querySelectorAll('details button')].find((button) => button.textContent === '哭脸')
    previewButton.click()
    const expressionPreview = pet.animation === 'Sad_Begin' && getComputedStyle(settings).display === 'none'
    pet.openPanel()
    const legacyDecorationRemoved = ![...settings.querySelectorAll('summary')].some((item) => item.textContent === 'CRT 显示效果') &&
      (await fetch('/dsh-closure/crt')).status === 410
    pet.closePanel()
    pet.play('Idle', true)
    const now = Date.now
    let workingDialogue, workingOnlyOnce, idleDialogue, idleOnlyOnce, completionDialogue, failedTurnSkipsCompletion
    const workingCues = { a23: '零号油罐', a34: '别急，我还在算呢。' }
    let firstWorkingVoice
    let elapsed = 0
    try {
      const base = now()
      Date.now = () => base + elapsed
      pet.hideBubble()
      pet.applyState(state('thinking', 4))
      const thinking = pet.layers.work === 'Special_B'
      pet.applyState(state('outputting', 4))
      if (!thinking || pet.layers.work !== 'Talk') throw new Error('Work animations did not follow activity')
      pet.hideBubble()
      elapsed = 14_999
      pet.applyState(state('thinking', 4))
      const noEarlyWorking = bubble.style.opacity === '0'
      elapsed++
      pet.applyState(state('thinking', 4))
      firstWorkingVoice = Object.keys(workingCues).find((id) => bubbleText().includes(workingCues[id]))
      workingDialogue = noEarlyWorking && Boolean(firstWorkingVoice)
      pet.hideBubble()
      elapsed += 1_000
      pet.applyState(state('thinking', 4))
      workingOnlyOnce = bubble.style.opacity === '0'

      pet.applyState(state('idle', 4, 1))
      const text = bubbleText()
      completionDialogue = text.includes('奖励一下') && !text.includes('3.25') &&
        !text.includes('85.5%') && !text.includes('Token')
      pet.hideBubble()
      pet.applyState(state('idle', 4, 2, 'error'))
      failedTurnSkipsCompletion = bubble.style.opacity === '0' || !bubbleText().includes('奖励一下')
      pet.hideBubble()
      elapsed += 299_999
      pet.applyState(state('idle', 4, 2))
      const noEarlyIdle = bubble.style.opacity === '0'
      elapsed++
      pet.applyState(state('idle', 4, 2))
      idleDialogue = noEarlyIdle && bubbleText().includes('辅助就交给我吧')
      pet.hideBubble()
      elapsed += 1_000
      pet.applyState(state('idle', 4, 2))
      idleOnlyOnce = bubble.style.opacity === '0'
    } finally {
      Date.now = now
    }
    pet.hideBubble()
    pet.runStartup()
    const startupDialogue = bubbleText().includes('模拟正式开始')
    pet.hideBubble()
    const balanceState = {
      ...state('idle', 4, 2),
      closureCompanion: { source: 'thirdParty', balance: { remaining: 120.5, unit: 'USD' }, quota: [], tokenUsage },
    }
    pet.applyState(balanceState)
    click(hitPoint())
    const text = bubbleText()
    const noQuotaOnClick = !text.includes('账户余额') && !text.includes('Token')
    const otherWorkingVoice = firstWorkingVoice === 'a23' ? 'a34' : 'a23'
    const clickSharesWorkingQueue = text.includes(workingCues[otherWorkingVoice])
    voiceControl.click()
    click(hitPoint())
    const interactionRotates = await waitFor(() => pet.voice?.id === firstWorkingVoice)
    pet.hideBubble()
    let automaticQuota, noQuotaSticker
    try {
      const base = now()
      Date.now = () => base + 60_000
      pet.applyState(balanceState)
      const reminderOff = bubble.style.opacity === '0'
      notification.querySelector('button[data-minutes="1"]').click()
      pet.applyState(balanceState)
      const quotaText = bubbleText()
      automaticQuota = reminderOff && bubble.style.opacity === '1' &&
        quotaText.includes('账户余额120.50USD') &&
        quotaText.includes('这段对话共用了12,480Token') && quotaText.includes('这轮用了900Token')
      pet.applyState(state('idle', 4, 2))
      pet.showValleySticker()
      noQuotaSticker = !document.querySelector('#dsh-closure-pet-sticker')
    } finally {
      Date.now = now
    }
    defaultMode.click()
    return { dragged, clicked, panelOpened, fpsSliderWorks, notificationsSaved, defaultQueues, defaultOverridesPersonal, queueEditor, voiceSettings, voiceVolumeWorks,
      startVoice, clickKeepsDialogue, startRotates, expressionPreview, legacyDecorationRemoved, startupScheduled,
      workingDialogue, workingOnlyOnce, completionDialogue, failedTurnSkipsCompletion, idleDialogue, idleOnlyOnce,
      startupDialogue, noQuotaOnClick, automaticQuota, noQuotaSticker, clickSharesWorkingQueue, interactionRotates,
      questionVoice, answerRotation,
      disabledToolNotice, toolVoice, toolVoiceRotates, toolTextWithoutVoice }
  })()`)
  if (!Object.values(result).every(Boolean)) {
    throw new Error(`Interaction check failed: ${JSON.stringify(result)}`)
  }
  const preview = await win.webContents.capturePage()
  if (preview.isEmpty()) throw new Error('Spine render is empty.')
  if (process.env.CLOSURE_SMOKE_PNG) await writeFile(process.env.CLOSURE_SMOKE_PNG, preview.toPNG())
  await win.loadURL(win.webContents.getURL())
  const reloaded = await evaluate(`(async () => {
    const { settings } = await import('/dsh-closure/assets/src/core/settings.js')
    const { getVoiceQueues, normalizeSettings } = await import('/dsh-closure/assets/src/shared/protocol.js')
    const queues = settings.voiceQueues
    const oldProfile = normalizeSettings({ voiceQueues: { start: [] } })
    const queuesReloaded = queues.start.join() === 'a18,a19' && queues.working.join() === 'a23,a34' &&
      queues.completion.join() === 'a30' && queues.startup.join() === 'b01' && queues.idle.join() === 'b03' &&
      queues.toolFailure.length === 0 && settings.voiceQueueMode === 'default' &&
      getVoiceQueues(settings).start.join() === 'a18,a19,a21,a23,a24' &&
      getVoiceQueues(settings).toolFailure.join() === 'a31,a32' &&
      Object.values(oldProfile.voiceQueues).every((queue) => queue.length === 0) && getVoiceQueues(oldProfile).start[0] === 'a18'
    return { queuesReloaded, fpsReloaded: settings.fps === 45 }
  })()`)
  if (!Object.values(reloaded).every(Boolean)) throw new Error(`Settings did not survive reload: ${JSON.stringify(reloaded)}`)
  console.log(JSON.stringify({ ...result, ...reloaded }))
}

async function runBubbleFollowSmoke(win) {
  const result = await win.webContents.executeJavaScript(`(async () => {
    for (let n = 0; n < 100 && window.__dshClosurePet?.phase !== 'running'; n++) {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    const pet = window.__dshClosurePet
    pet.cancelStartup()
    pet.closePanel()
    const host = document.querySelector('#dsh-closure-pet')
    const canvas = host.querySelector('canvas')
    pet.showBubble('博士，拖动时这句话也会跟着走。', 60000)
    await document.fonts.ready
    await new Promise((resolve) => setTimeout(resolve, 350))
    const bubble = document.querySelector('#dsh-closure-pet-bubble')
    const text = bubble.textContent
    const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    const follows = () => {
      const rect = host.getBoundingClientRect()
      const w = parseFloat(bubble.style.width) - 6
      const h = parseFloat(bubble.style.height) - 6
      const center = rect.left + rect.width / 2
      let left = Math.round(center - w * (center < innerWidth / 2 ? .32 : .68))
      left = Math.min(Math.max(8, left), Math.max(8, innerWidth - w - 6 - 8))
      let top = Math.round(rect.top - h - 2)
      const below = top < 8
      if (below) top = Math.round(rect.bottom + 2)
      top = Math.min(Math.max(8, top), Math.max(8, innerHeight - h - 6 - 8))
      return Math.abs(parseFloat(bubble.style.left) - left) <= 2 &&
        Math.abs(parseFloat(bubble.style.top) - top) <= 2 &&
        bubble.style.transformOrigin === (below ? 'center top' : 'center bottom')
    }
    let point
    const initial = canvas.getBoundingClientRect()
    for (let y = initial.top + 3; y < initial.bottom && !point; y += 6) {
      for (let x = initial.left + 3; x < initial.right; x += 6) {
        if (pet.hitTest(x, y)) { point = { x, y }; break }
      }
    }
    if (!point) throw new Error('No drag hit point')
    const pointer = (type, x, y) => canvas.dispatchEvent(new PointerEvent(type, {
      pointerId: 7, pointerType: 'mouse', button: 0, clientX: x, clientY: y, bubbles: true, cancelable: true,
    }))
    pointer('pointerdown', point.x, point.y)
    let measurements = 0
    const measure = CanvasRenderingContext2D.prototype.measureText
    CanvasRenderingContext2D.prototype.measureText = function (...args) {
      measurements++
      return measure.apply(this, args)
    }
    let midDrag, noTextMeasurement, flippedBelow, flippedAbove, snapFollows = true, snapMoved
    try {
      const moveTo = async (left, top) => {
        pointer('pointermove', point.x + left - initial.left, point.y + top - initial.top)
        await frame()
        return follows()
      }
      midDrag = await moveTo(300, 200)
      noTextMeasurement = measurements === 0 && bubble.textContent === text
      flippedBelow = await moveTo(0, 0) && bubble.style.transformOrigin === 'center top'
      flippedAbove = await moveTo(0, 240) && bubble.style.transformOrigin === 'center bottom'
      pointer('pointerup', point.x - initial.left, point.y + 240 - initial.top)
      let previousLeft = host.getBoundingClientRect().left
      snapMoved = false
      const until = performance.now() + 290
      while (performance.now() < until) {
        await frame()
        snapFollows = snapFollows && follows()
        const left = host.getBoundingClientRect().left
        if (Math.abs(left - previousLeft) > .1) snapMoved = true
        previousLeft = left
      }
      const settled = canvas.getBoundingClientRect()
      let nextPoint
      for (let y = settled.top + 3; y < settled.bottom && !nextPoint; y += 6) {
        for (let x = settled.left + 3; x < settled.right; x += 6) {
          if (pet.hitTest(x, y)) { nextPoint = { x, y }; break }
        }
      }
      if (!nextPoint) throw new Error('No settled drag hit point')
      pointer('pointerdown', nextPoint.x, nextPoint.y)
      pointer('pointermove', nextPoint.x + 40, nextPoint.y - 20)
      pet.hideBubble()
      const hiddenPosition = bubble.style.left + ':' + bubble.style.top
      await frame()
      const hiddenStaysHidden = bubble.style.opacity === '0' && hiddenPosition === bubble.style.left + ':' + bubble.style.top
      pointer('pointercancel', nextPoint.x + 40, nextPoint.y - 20)
      return { midDrag, noTextMeasurement, flippedBelow, flippedAbove, snapFollows, snapMoved, hiddenStaysHidden }
    } finally {
      CanvasRenderingContext2D.prototype.measureText = measure
      pet.hideBubble()
      pet.resetPosition()
    }
  })()`)
  if (!Object.values(result).every(Boolean)) throw new Error(`Bubble follow check failed: ${JSON.stringify(result)}`)
  console.log(JSON.stringify({ bubbleFollow: result }))
}

async function runBubbleAppearanceSmoke(win) {
  const waitReady = async () => {
    for (let n = 0; n < 100; n++) {
      if (await win.webContents.executeJavaScript("window.__dshClosurePet?.phase === 'running'")) return
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    throw new Error('Bubble settings fixture did not start')
  }
  await waitReady()
  const evaluate = source => win.webContents.executeJavaScript(source)
  const controls = await evaluate(`(async () => {
    const pet = window.__dshClosurePet
    pet.cancelStartup()
    pet.showBubble('博士，对话字号与气泡宽度可以分别调整，拖动时也会继续跟随。'.repeat(3), 60000)
    await document.fonts.ready
    await new Promise(resolve => setTimeout(resolve, 350))
    pet.openPanel()
    const panel = document.querySelector('#dsh-closure-pet-settings')
    const font = panel.querySelector('[aria-label="对话字号"]'), scale = panel.querySelector('[aria-label="气泡大小"]')
    const bubble = document.querySelector('#dsh-closure-pet-bubble'), text = bubble.lastElementChild
    const originalText = bubble.textContent.replace(/\\s/g, '')
    const defaults = font.value === '24' && scale.value === '1'
    const set = (input, value) => { input.value = value; input.dispatchEvent(new Event('input', { bubbles:true })) }
    set(font, '18')
    const fontWorks = getComputedStyle(text).fontSize === '18px' && scale.value === '1' && bubble.style.opacity === '1'
    set(font, '24');set(scale, '.6')
    const narrowWidth = parseFloat(bubble.style.width)
    set(scale, '1.6')
    const scaleWorks = parseFloat(bubble.style.width) > narrowWidth && getComputedStyle(text).fontSize === '24px'
    set(font, '36')
    const largeFont = getComputedStyle(text).fontSize === '36px' && bubble.textContent.replace(/\\s/g, '') === originalText
    pet.setSettings({ bubble:false })
    set(font, '30')
    const disabledStaysHidden = bubble.style.opacity === '0'
    pet.setSettings({ bubble:true })
    set(font, '36')
    pet.showBubble('博士，对话字号与气泡宽度可以分别调整，拖动时也会继续跟随。'.repeat(3), 60000)
    return { defaults, fontWorks, scaleWorks, largeFont, disabledStaysHidden }
  })()`)
  win.webContents.debugger.attach('1.3')
  await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width:320,height:300,deviceScaleFactor:1,mobile:false })
  await new Promise(resolve => setTimeout(resolve, 500))
  const smallScreen = await evaluate(`(() => {
    const bubble=document.querySelector('#dsh-closure-pet-bubble'),r=bubble.getBoundingClientRect()
    const font=parseFloat(getComputedStyle(bubble.lastElementChild).fontSize)
    return {fits:r.left>=7 && r.top>=7 && r.right<=innerWidth-7 && r.bottom<=innerHeight-7 &&
      font<36 && window.__dshClosurePet.settings.bubbleFontSize===36,
      rect:{left:r.left,top:r.top,right:r.right,bottom:r.bottom},width:innerWidth,height:innerHeight,font}
  })()`)
  await win.webContents.debugger.sendCommand('Emulation.clearDeviceMetricsOverride')
  win.webContents.debugger.detach()
  await new Promise(resolve => setTimeout(resolve, 500))
  const restored = await evaluate(`(() => {
    const pet=window.__dshClosurePet,bubble=document.querySelector('#dsh-closure-pet-bubble')
    const restored=getComputedStyle(bubble.lastElementChild).fontSize==='36px'
    pet.setSettings({bubbleFontSize:30,bubbleScale:1.25});pet.openPanel()
    const saved=JSON.parse(localStorage.getItem('dshcl-settings'))
    return restored && saved.bubbleFontSize===30 && saved.bubbleScale===1.25 &&
      document.querySelector('[aria-label="对话字号"]').value==='30' && document.querySelector('[aria-label="气泡大小"]').value==='1.25'
  })()`)
  if (process.env.CLOSURE_BUBBLE_PNG) await writeFile(process.env.CLOSURE_BUBBLE_PNG, (await win.webContents.capturePage()).toPNG())
  await win.loadURL(win.webContents.getURL())
  await waitReady()
  const persisted = await evaluate("window.__dshClosurePet.settings.bubbleFontSize===30 && window.__dshClosurePet.settings.bubbleScale===1.25")
  const result={...controls,smallScreen:smallScreen.fits,restored,persisted}
  if (!Object.values(result).every(Boolean)) throw new Error('Bubble appearance check failed: '+JSON.stringify({...result,smallScreenDetails:smallScreen}))
  console.log(JSON.stringify({bubbleAppearance:result}))
}

async function runExitSmoke(win) {
  for (let n = 0; n < 100; n++) {
    if (await win.webContents.executeJavaScript("window.__dshClosurePet?.phase === 'running'")) break
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  const timeout = setTimeout(() => { console.error('Right-click exit did not quit'); app.exit(1) }, 3000)
  app.once('before-quit', () => {
    clearTimeout(timeout)
    console.log(JSON.stringify({ rightClickExit: true }))
  })
  const found = await win.webContents.executeJavaScript(`(() => {
    window.__dshClosurePet.openPanel()
    const panel = document.querySelector('#dsh-closure-pet-settings')
    const button = [...panel.querySelectorAll('button')].find((item) => item.textContent === '退出桌宠')
    if (!button || getComputedStyle(panel).display !== 'block') return false
    setTimeout(() => button.click(), 100)
    return true
  })()`)
  if (!found) throw new Error('Right-click menu has no exit button')
}

if (!smoke && !app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.whenReady().then(async () => {
    let activity
    let quota
    function configureActivity(codexLinked) {
      activity?.stop()
      quota?.stop()
      const followActivity = codexLinked && !dev && !process.argv.includes('--no-activity')
      activity = createActivity(followActivity, path.join(codexHome, 'sessions'), { desktopOnly: macPort })
      quota = followActivity ? createQuota({ enabled: true, home: codexHome }) : null
    }
    app.once('before-quit', () => { activity?.stop(); quota?.stop() })
    registerProtocol(() => {
      const snapshot = activity.snapshot()
      if (quota) {
        const limits = quota.snapshot()
        if (macPort && !limits.quota.length && ['official', 'checking'].includes(limits.source)) {
          limits.quota = snapshot.closureCompanion.quota
        }
        Object.assign(snapshot.closureCompanion, limits)
      }
      return snapshot
    })
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: new URL(details.url).protocol !== `${scheme}:` }))
    const win = new BrowserWindow({
      width: 900, height: 620, frame: demo, transparent: !demo, show: false,
      paintWhenInitiallyHidden: dev,
      resizable: demo, alwaysOnTop: !dev, focusable: dev, skipTaskbar: !demo, hasShadow: false,
      ...(macPort && { acceptFirstMouse: true, type: 'panel' }),
      backgroundColor: demo ? '#151424' : '#00000000',
      title: '可露希尔 · Codex 桌宠',
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'), sandbox: true, contextIsolation: true,
        nodeIntegration: false, offscreen: smoke, backgroundThrottling: !smoke && !macPort,
        autoplayPolicy: 'no-user-gesture-required',
      },
    })
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', (event) => event.preventDefault())
    registerExit(win)
    if (!dev) {
      if (macPort) {
        win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
        registerMacTheme(win)
      }
      registerInput(win)
      win.webContents.once('render-process-gone', () => app.exit(1))
      const petWindow = managePetWindow(win, macPort)
      const runtime = await createRuntimeController({
        profile,
        defaults: macPort ? { codexLinked: true, startAtLogin: false } : undefined,
        setStartup: macPort ? (enabled) => macStartupSetting(app, enabled) : startupSetting,
        onLinkedChange: async (enabled) => {
          configureActivity(enabled)
          await petWindow.setLinked(enabled)
        },
        onDisplayChange: async (enabled) => { await petWindow.setShowOutsideCodex(enabled) },
      })
      registerRuntimeSettings(win, runtime)
      configureActivity(runtime.snapshot().codexLinked)
      await petWindow.setShowOutsideCodex(runtime.snapshot().showOutsideCodex)
      await petWindow.setLinked(runtime.snapshot().codexLinked)
      if (!macPort) startWatcher()
    } else {
      configureActivity(true)
      if (smoke) {
        // Exercise the production controller and IPC without changing Windows startup.
        let registered = true
        const runtime = await createRuntimeController({
          profile,
          setStartup: async (enabled) => { if (enabled !== undefined) registered = enabled; return registered },
          onLinkedChange: async (enabled) => { await win.loadURL(`${origin}/?codexLinked=${enabled}${canvas ? '&canvas=1' : ''}`) },
        })
        await runtime.update('codexLinked', true)
        registerRuntimeSettings(win, runtime)
      }
      await win.loadURL(`${origin}/${canvas ? '?canvas=1' : ''}`)
    }
    if (demo) win.show()
    if (smoke) {
      await runSmoke(win)
      await runBubbleAppearanceSmoke(win)
      await runBubbleFollowSmoke(win)
      await runRuntimeSmoke(win)
      await runExitSmoke(win)
    }
  }).catch((error) => {
    console.error(error)
    if (!smoke) dialog.showErrorBox('Closure Companion', '嗯？我这边没启动起来。博士，桌宠初始化失败了。')
    app.exit(1)
  })
}

app.on('window-all-closed', () => app.quit())
