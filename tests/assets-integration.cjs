// Decode every shipped voice/sound and validate all selectable asset mappings.
// The app remains hidden; no audio source is connected or played.
const { app, BrowserWindow, protocol } = require('electron')
const fs = require('node:fs/promises')
const path = require('node:path')
const assert = require('node:assert/strict')
const root = process.env.CLOSURE_TEST_PACKAGE_ROOT || path.resolve(__dirname, '..')
const { version } = require(path.resolve(root, 'outputs/closure-companion/package.json'))
const assets = path.join(root, 'outputs/closure-companion/upstream/assets')
const output = process.env.CLOSURE_TEST_OUTPUT || path.resolve(__dirname, '../work', `release-${version}`, 'assets')
app.setPath('userData', path.join(output, 'profile'))
app.commandLine.appendSwitch('disable-background-networking')
protocol.registerSchemesAsPrivileged([{ scheme: 'closure-assets', privileges: { standard: true, secure: true, supportFetchAPI: true } }])
app.whenReady().then(async () => {
  await fs.mkdir(output, { recursive: true })
  protocol.handle('closure-assets', async request => {
    const url = new URL(request.url)
    if (url.pathname === '/') return new Response('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>', { headers: { 'content-type': 'text/html' } })
    const relative = decodeURIComponent(url.pathname.slice(1))
    const target = path.resolve(assets, relative)
    if (!target.startsWith(assets + path.sep)) return new Response(null, { status: 403 })
    const contentType = { '.js': 'text/javascript', '.ogg': 'audio/ogg', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json' }[path.extname(target)] || 'text/plain'
    return new Response(await fs.readFile(target), { headers: { 'content-type': contentType } })
  })
  const win = new BrowserWindow({ width: 900, height: 600, show: false, focusable: false, skipTaskbar: true,
    webPreferences: { offscreen: true, backgroundThrottling: false, sandbox: true, contextIsolation: true } })
  const errors = []
  win.webContents.on('console-message', (event, ...rest) => {
    const details = typeof rest[0] === 'number' ? { level: rest[0], message: rest[1] } : event
    if (details.level === 'error' || details.level === 3) errors.push(details.message)
  })
  win.webContents.session.webRequest.onBeforeRequest((value, done) => done({ cancel: !['closure-assets:', 'data:', 'blob:'].includes(new URL(value.url).protocol) }))
  await win.loadURL('closure-assets://local/')
  const files = []
  const sounds = (await fs.readdir(path.join(assets, 'audio'))).filter(name => name.endsWith('.ogg'))
  for (const name of sounds) files.push('audio/' + name)
  for (const language of await fs.readdir(path.join(assets, 'audio/voice'))) {
    for (const name of await fs.readdir(path.join(assets, 'audio/voice', language))) if (name.endsWith('.ogg')) files.push(`audio/voice/${language}/${name}`)
  }
  const report = await win.webContents.executeJavaScript(`(async()=>{
    const {dialogue,DEFAULT_VOICE_QUEUES,voiceLanguageFor}=await import('/src/core/dialogue.js');
    const {VOICE_LANGUAGES}=await import('/src/shared/protocol.js');
    const files=${JSON.stringify(files)},available=new Set(files),missing=[];
    let mappings=0;
    for(const id of Object.keys(dialogue))for(const language of Object.keys(VOICE_LANGUAGES)){
      mappings++;const name='audio/voice/'+voiceLanguageFor(id,language)+'/'+id+'.ogg';if(!available.has(name))missing.push(name);
    }
    for(const ids of Object.values(DEFAULT_VOICE_QUEUES))for(const id of ids)if(!dialogue[id])throw Error('Unknown queued clip: '+id);
    if(missing.length)throw Error('Missing selectable voices: '+missing.join(', '));
    const context=new AudioContext(),decoded=[];
    let index=0;
    await Promise.all(Array.from({length:4},async()=>{
      for(;;){const file=files[index++];if(!file)return;const response=await fetch('/'+file);if(!response.ok)throw Error(file+' unavailable');
        const buffer=await context.decodeAudioData(await response.arrayBuffer());
        if(!(buffer.duration>0&&buffer.duration<300))throw Error('Invalid audio duration: '+file);
        decoded.push({file,duration:buffer.duration,channels:buffer.numberOfChannels});
      }
    }));
    await context.close();
    const image=new Image();image.src='/spine/ac_s_closur_spine.png';await image.decode();
    const font=new FontFace('AssetCheck','url(/fonts/ark-pixel-12px-zh_hans.woff2)');await font.load();document.fonts.add(font);
    return {passed:true,voiceIds:Object.keys(dialogue).length,languages:Object.keys(VOICE_LANGUAGES),selectableVoiceMappings:mappings,decodedAudioFiles:decoded.length,
      sounds:${JSON.stringify(sounds)},texture:{width:image.naturalWidth,height:image.naturalHeight},fontLoaded:font.status==='loaded',decoded};
  })()`)
  assert.equal(report.voiceIds, 57)
  assert.equal(report.selectableVoiceMappings, 228)
  assert.equal(report.decodedAudioFiles, files.length)
  assert.equal(report.fontLoaded, true)
  assert.equal(sounds.length, 4)
  const skeleton = JSON.parse(await fs.readFile(path.join(assets, 'spine/ac_s_closur_spine.json'), 'utf8'))
  const animations = Object.keys(skeleton.animations)
  for (const name of ['Idle', 'Sad_Begin', 'Sad_Idle', 'Happy', 'Special_A', 'Special_B', 'Talk', 'Interact']) assert.ok(animations.includes(name), name)
  assert.deepEqual(errors, [])
  report.animations = animations
  report.hidden = !win.isVisible()
  report.rendererErrors = errors
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ ...report, decoded: undefined }))
  app.exit(0)
}).catch(error => { console.error(error); app.exit(1) })
setTimeout(() => app.exit(2), 60000).unref()
