const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const source = readFileSync(path.join(__dirname, '../outputs/closure-companion/main.cjs'), 'utf8')
const followCodex = source.slice(source.indexOf('function followCodex('), source.indexOf('function registerInput('))
let tracker
let lines
const screen = new EventEmitter()
const win = new EventEmitter()
let visible = false
let bounds
let quit = 0
let scale = 1
let trackerStopped = false
let trackerArgs
let retry
screen.screenToDipRect = (_window, rect) => ({
  x: rect.x, y: rect.y, width: rect.width / scale, height: rect.height / scale,
})
Object.assign(win, {
  getNativeWindowHandle: () => Buffer.alloc(8),
  isDestroyed: () => false,
  isVisible: () => visible,
  showInactive: () => { visible = true },
  hide: () => { visible = false },
  setBounds: (rect) => { bounds = rect },
  getBounds: () => bounds,
  loadURL: async () => {},
})
const display = { id: 1, workArea: { x: 12, y: 20, width: 1000, height: 750 } }
Object.assign(screen, {
  getAllDisplays: () => [display], getPrimaryDisplay: () => display,
  getDisplayMatching: () => display, getDisplayNearestPoint: () => display,
  getCursorScreenPoint: () => ({ x: 0, y: 0 }),
})
const petWindow = vm.runInNewContext(`${followCodex}\nmanagePetWindow(win)`, {
  win, screen, path, __dirname, process, console, canvas: false,
  setTimeout: (callback) => { retry = callback; return 1 }, clearTimeout: () => { retry = undefined },
  URLSearchParams, origin: 'closure-pet://local',
  spawn: (_executable, args) => {
    trackerArgs = args
    tracker = new EventEmitter()
    tracker.stderr = new EventEmitter()
    tracker.kill = () => { trackerStopped = true }
    lines = new EventEmitter()
    lines.close = () => {}
    return tracker
  }, readline: { createInterface: () => lines }, app: { quit: () => { quit++ } },
})
async function checkWindow() {
  await petWindow.setShowOutsideCodex(true)
  await petWindow.setLinked(false)
  assert.equal(visible, true, 'the default desktop pet needs no Codex window')
  assert.deepEqual(bounds, display.workArea)
  await petWindow.setLinked(true)
  assert.equal(visible, true, 'enabling activity linkage keeps the desktop pet visible')
  assert.deepEqual(bounds, display.workArea, 'activity linkage does not move the desktop window')
  assert.equal(tracker, undefined, 'activity linkage alone does not start window following')
  await petWindow.setShowOutsideCodex(false)
  assert.equal(visible, false, 'only the display option restricts the pet to Codex')
  const report = (state) => lines.emit('line', JSON.stringify(state))
  const main = { visible: true, x: 0, y: 0, width: 1200, height: 800 }
  report(main)
  assert.equal(visible, true)
  assert.equal(bounds.width, 1200)
  for (const transition of ['picker', 'minimize']) {
    report({ visible: false })
    assert.equal(visible, false, transition)
    report(main)
    assert.equal(visible, true, transition)
  }
  scale = 1.5
  report({ ...main, x: -1600 })
  assert.equal(bounds.x, -1600)
  assert.equal(bounds.width, 800)
  scale = 2
  screen.emit('display-metrics-changed')
  assert.equal(bounds.width, 600)
  const oldTracker = tracker
  await petWindow.setLinked(false)
  assert.equal(trackerStopped, false, 'disabling activity linkage leaves window following unchanged')
  assert.equal(bounds.width, 600)
  report({ visible: false })
  assert.equal(visible, false, 'Codex-only display works even without activity linkage')
  await petWindow.setShowOutsideCodex(true)
  assert.equal(trackerStopped, true)
  assert.equal(visible, true)
  assert.deepEqual(bounds, display.workArea)
  report({ visible: false })
  oldTracker.emit('close')
  assert.equal(visible, true)
  assert.equal(quit, 0)
  await petWindow.setLinked(true)
  assert.equal(visible, true, 'linkage does not override the outside-Codex display preference')
  await petWindow.setShowOutsideCodex(false)
  assert.equal(visible, false)
  report(main)
  assert.equal(visible, true)
  tracker.emit('close')
  assert.equal(visible, false)
  assert.equal(quit, 0, 'tracker loss must not exit the pet')
  assert.ok(retry, 'a failed tracker is restarted')
  retry()
  report(main)
  assert.equal(visible, true)
  await petWindow.setLinked(false)
  assert.equal(visible, true)
  await petWindow.setShowOutsideCodex(true)
  assert.equal(visible, true)
  await petWindow.setHosts({ dshLinked: true, workbuddyLinked: true })
  await petWindow.setShowOutsideCodex(false)
  assert.equal(trackerArgs[trackerArgs.indexOf('-Hosts') + 1], 'dsh,workbuddy')
  report(main)
  assert.equal(visible, true, 'linked host windows can use the restricted display mode')
  await petWindow.setHosts({ codexLinked: true })
  assert.equal(trackerArgs[trackerArgs.indexOf('-Hosts') + 1], 'codex', 'changing enabled hosts refreshes the restricted tracker')
  await petWindow.setShowOutsideCodex(true)
  win.emit('closed')
  assert.equal(trackerStopped, true)
  assert.equal(screen.listenerCount('display-metrics-changed'), 0)
  assert.equal(retry, undefined)
}
require('node:test').test('Codex linkage and display scope stay independent without a tray', checkWindow)

require('node:test').test('right-click quit accepts only the pet main frame', () => {
  const ipcMain = new EventEmitter()
  const webContents = { mainFrame: {} }
  let exits = 0
  const register = source.slice(source.indexOf('function registerExit('), source.indexOf('function registerRuntimeSettings('))
  vm.runInNewContext(`${register}\nregisterExit(win)`, {
    ipcMain, win: { webContents }, app: { quit: () => { exits++ } },
  })
  ipcMain.emit('closure:quit', { sender: {}, senderFrame: webContents.mainFrame })
  ipcMain.emit('closure:quit', { sender: webContents, senderFrame: {} })
  assert.equal(exits, 0)
  ipcMain.emit('closure:quit', { sender: webContents, senderFrame: webContents.mainFrame })
  assert.equal(exits, 1)
})
