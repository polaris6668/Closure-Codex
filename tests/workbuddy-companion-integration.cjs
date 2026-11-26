// Real installed renderer and SDK, synthetic offline host, hidden window.
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs/promises')
const path = require('node:path')
const assert = require('node:assert/strict')
const root = path.resolve(__dirname, '..')
const packageRoot = process.env.CLOSURE_TEST_PACKAGE_ROOT || root
const output = process.env.CLOSURE_TEST_OUTPUT || path.join(root, 'work/companion-integration/workbuddy')
const renderer = path.join(root, 'work/workbuddy-theme/host/renderer/index.html')
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
app.setPath('userData', path.join(output, 'profile'))
app.commandLine.appendSwitch('disable-background-networking')
app.whenReady().then(async () => {
  await fs.mkdir(output, { recursive: true })
  const win = new BrowserWindow({ width: 1200, height: 800, show: false, focusable: false, skipTaskbar: true,
    webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, backgroundThrottling: false } })
  win.webContents.session.webRequest.onBeforeRequest((value, done) => done({ cancel: !['file:', 'data:', 'blob:', 'about:'].includes(new URL(value.url).protocol) }))
  await win.loadURL('about:blank')
  win.webContents.debugger.attach('1.3')
  await win.webContents.debugger.sendCommand('Page.enable')
  const fixture = (await fs.readFile(path.join(__dirname, 'workbuddy-theme-fixture.cjs'), 'utf8'))
    .replace("if(channel==='auth:getToken')", "if(channel==='auth:getAccountUsage')return {usageLeft:'2100'};\n    if(channel==='auth:getToken')")
  await win.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: fixture })
  await win.loadFile(renderer)
  const evaluate = source => win.webContents.executeJavaScript(source)
  for (let i = 0; i < 100; i++) {
    if (await evaluate("Boolean(window.wb?.conversations?.on && document.querySelector('[contenteditable=true]'))")) break
    await delay(100)
  }
  const installed = await evaluate(await fs.readFile(path.join(packageRoot, 'outputs/closure-companion/workbuddy-renderer.js'), 'utf8'))
  assert.equal(installed, true)
  await delay(500)
  await evaluate(`(() => {
    const id='closure-theme-test',bus=wb.$bus;
    bus.emit('wb:conversations:listProgress',{space:'local',list:{items:[{id,state:'idle',transport:'local'}]}});
    bus.emit('wb:conversation:stateChange',{conversationId:id,from:'idle',to:'working'});
    bus.emit('wb:conversation:requestUpdate',{conversationId:id,requestId:'r',messageId:'m',patches:[],chunk:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'PRIVATE RESPONSE'}}});
    bus.emit('wb:conversation:permission',{conversationId:id,permission:{id:'q',category:'question',questions:[{question:'PRIVATE QUESTION'}]}});
    bus.emit('wb:conversation:requestUpdate',{conversationId:id,requestId:'r',messageId:'q',patches:[],chunk:{sessionUpdate:'tool_call_update',toolCallId:'q',status:'completed'}});
    bus.emit('wb:conversation:stateChange',{conversationId:id,from:'working',to:'idle'});
  })()`)
  const value = await evaluate('window.__closureCompanionBridge.snapshot()')
  assert.deepEqual(value.events.map(e => e.kind), ['start', 'mode', 'question', 'tool', 'answer', 'end'])
  assert.equal(value.events.at(-1).data.kind, 'completed')
  assert.doesNotMatch(JSON.stringify(value), /PRIVATE/)
  const assets = path.join(path.dirname(renderer), 'assets')
  const candidates = (await fs.readdir(assets)).filter(n => /^runtime-[\w-]+\.js$/.test(n))
  let runtime
  for (const candidate of candidates) if ((await fs.readFile(path.join(assets, candidate), 'utf8')).includes('authGetAccountUsage')) runtime = candidate
  assert.match(runtime, /^runtime-/)
  const credits = await evaluate(`import('./assets/${runtime}').then(m=>m.n().authGetAccountUsage({locale:'zh'})).then(v=>v.usageLeft)`)
  assert.equal(credits, '2100')
  await evaluate('window.__closureCompanionBridge.dispose()')
  assert.equal(await evaluate('typeof window.__closureCompanionBridge'), 'undefined')
  const report = { passed: true, nativeSdk: true, eventKinds: value.events.map(e => e.kind), officialAccountApi: true, sanitized: true, hidden: true }
  await fs.writeFile(path.join(output, 'verification.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
  app.exit(0)
}).catch(e => { console.error(e); app.exit(1) })
setTimeout(() => { console.error('Hidden WorkBuddy integration timed out'); app.exit(2) }, 30000).unref()
