// Tests the packaged client bundle inside a real isolated DSH 0.2.2 Web host.
// Set CLOSURE_DSH_TEST_URL to that host's authenticated launch URL.
// No prompts are sent, no user's DSH profile is read or changed.
const { app, BrowserWindow } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const {checkFolder, checkCodePanel} = require('./theme-detail-checks.cjs')
const root = path.resolve(__dirname, '..')
const output = process.env.CLOSURE_DSH_TEST_OUTPUT || path.join(root, 'work/dsh-theme/verification')
const ID = 'dsh-closure-codex-theme'
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
app.setPath('userData', path.join(output, 'profile'))
app.commandLine.appendSwitch('disable-background-networking')
app.whenReady().then(async () => {
  const url = new URL(process.env.CLOSURE_DSH_TEST_URL)
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname), 'Use an isolated loopback DSH host')
  await fs.mkdir(output, { recursive: true })
  const win = new BrowserWindow({ width: 1400, height: 900, show: false, focusable: false, skipTaskbar: true,
    webPreferences: { offscreen: true, backgroundThrottling: false, sandbox: true, contextIsolation: true } })
  const errors = []
  const layoutNotices = []
  let phase = 'boot'
  win.webContents.on('console-message', (...args) => {
    const details = typeof args[1] === 'number' ? { level: args[1], message: args[2] } : args[0]
    if (details.level === 'error' || details.level === 3) {
      // This exact Chromium notice also occurs when the theme is disabled on
      // DSH's 600px sidebar transition. Keep it visible in the report and check
      // against a separately captured unmodified-host baseline below.
      if (details.message === 'ResizeObserver loop completed with undelivered notifications.') {
        layoutNotices.push({phase,message:details.message})
        return
      }
      errors.push(details.message)
      console.error(`Renderer error during ${phase}: ${details.message}`)
    }
  })
  win.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    const target = new URL(details.url)
    const local = target.host === url.host && ['http:', 'ws:'].includes(target.protocol)
    callback({ cancel: !local && !['data:', 'blob:', 'about:'].includes(target.protocol) })
  })
  await win.loadURL('about:blank')
  win.webContents.debugger.attach('1.3')
  await win.webContents.debugger.sendCommand('Page.enable')
  // The desktop preload normally publishes these before the DSH shell boots.
  const marker = `(() => {
    const mark = () => {
      document.documentElement.setAttribute('data-windows-titlebar', '')
      document.documentElement.style.setProperty('--dsh-windows-titlebar-height', '40px')
    }
    if (document.documentElement) mark()
    else { const observer = new MutationObserver(() => { if(document.documentElement){mark();observer.disconnect()} });observer.observe(document,{childList:true}) }
    document.addEventListener('DOMContentLoaded',()=>{
      const probe=document.createElement('span')
      probe.style.cssText='position:fixed;visibility:hidden;pointer-events:none;background-color:var(--dsw-specific-sidebar-fill);color:var(--dsw-alias-label-primary)'
      document.body.append(probe)
    },{once:true})
  })()`
  await win.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: marker })
  console.log('Desktop marker registered')
  const evaluate = async source => {
    try { return await win.webContents.executeJavaScript(source) }
    catch (error) { console.error('Renderer expression:', source.slice(0,220)); console.error(errors); throw error }
  }
  const waitFor = async source => {
    for (let n = 0; n < 160; n++) { if (await evaluate(`Boolean(${source})`)) return; await delay(100) }
    await fs.writeFile(path.join(output, 'failure.png'), (await win.webContents.capturePage()).toPNG())
    await fs.writeFile(path.join(output, 'failure.json'), JSON.stringify(await evaluate(`({text:document.body.innerText,inputs:[...document.querySelectorAll('input,textarea,[contenteditable]')].map(n=>n.outerHTML.slice(0,500)),attrs:[...document.documentElement.attributes].map(a=>[a.name,a.value])})`), null, 2))
    throw Error(`Timed out: ${source}`)
  }
  await win.loadURL(url.href)
  console.log('DSH document loaded')
  await waitFor(`document.querySelector('.closure-dsh-navigation') && document.querySelector('[contenteditable=true]')`)
  console.log('DSH shell ready')
  // Dismiss the isolated profile's preview notice, if shown.
  await evaluate(`Array.from(document.querySelectorAll('[role=dialog] button')).find(b => b.textContent === '继续')?.click()`)
  await delay(300)
  const boot = await evaluate(`({release:window.__DSH_BOOT__.release, entries:window.__DSH_BOOT__.entries.filter(e=>JSON.stringify(e).includes('${ID}'))})`)
  assert.ok(boot.entries.length > 0, 'Plugin must arrive through DSH boot, not test injection')
  if (process.env.CLOSURE_DSH_BASELINE_LAYOUT === '1') {
    await waitFor(`!!window.__closureDshTest`)
    await evaluate(`window.__closureDshTest.enable(false)`)
    for (const [width,height] of [[1400,900],[900,650],[600,720]]) {
      phase = `unmodified DSH ${width}x${height}`
      win.setSize(width,height)
      await delay(450)
      await evaluate(`if(document.querySelector('[data-shell-overlay]').parentElement.hasAttribute('data-sidebar-collapsed')) document.querySelector('[data-sidebar-toggle]').click()`)
      await delay(450)
      await evaluate(`document.querySelector('[data-sidebar-toggle]').click()`)
      await delay(450)
    }
    assert.equal(win.isVisible(),false)
    assert.deepEqual(errors,[])
    await fs.writeFile(path.join(output,'baseline-layout.json'),JSON.stringify({pluginEnabled:false,errors,layoutNotices},null,2))
    console.log(JSON.stringify({baseline:true,errors,layoutNotices}))
    app.exit(0)
    return
  }
  const measurements = []
  const collapsedMeasurements = []
  await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true})
  for (const [width, height] of [[1400, 900], [900, 650], [600, 720]]) {
    phase = `expanded ${width}x${height}`
    win.setSize(width, height)
    await delay(450)
    // DSH automatically collapses below its breakpoint. Explicitly reopen the
    // real sidebar so narrow-window checks also cover workspace/session rows.
    await evaluate(`if(document.querySelector('.closure-dsh-frame').hasAttribute('data-sidebar-collapsed')) document.querySelector('[data-sidebar-toggle]').click()`)
    await waitFor(`document.querySelector('[data-row-key^="session:"]') && !document.querySelector('.closure-dsh-frame').hasAttribute('data-sidebar-collapsed')`)
    await delay(450)
    const value = await evaluate(`(() => {
      const frame = document.querySelector('.closure-dsh-frame')
      const sidebar = document.querySelector('.closure-dsh-sidebar')
      const column = document.querySelector('.closure-dsh-sidebar-column')
      const input = document.querySelector('[contenteditable=true]')
      const m = getComputedStyle(frame, '::before'), crt = getComputedStyle(document.documentElement, '::before')
      const i = input.getBoundingClientRect(), original = frame.getBoundingClientRect()
      const rect = node => {
        const b = node.getBoundingClientRect()
        return { left:b.left,top:b.top,right:b.right,bottom:b.bottom,width:b.width,height:b.height }
      }
      const workspaceNodes = {
        header:sidebar.querySelector('[data-sidebar-workspace-header]'),
        workspace:sidebar.querySelector('[data-row-key^="workspace:"]'),
        session:sidebar.querySelector('[data-row-key^="session:"]'),
        list:sidebar.querySelector('[data-sidebar-list-area]'),
      }
      const workspaceCoverage = Object.fromEntries(Object.entries(workspaceNodes).map(([name,node]) => {
        if (!node) return [name,{present:false}]
        const layers = []
        for (let parent=node;parent && parent!==column;parent=parent.parentElement) {
          const paint=getComputedStyle(parent)
          const alpha=paint.backgroundColor==='transparent' ? 0 : Number(paint.backgroundColor.match(/[\\d.]+/g)?.[3] ?? 1)
          const marker = parent.matches('[data-row-key^="session:"][aria-selected="true"]') &&
            paint.backgroundSize==='2px 16px' && paint.backgroundImage.includes('rgb(255, 62, 165)')
          layers.push({color:paint.backgroundColor,image:paint.backgroundImage,transparent:alpha<0.25 && (paint.backgroundImage==='none' || marker)})
        }
        return [name,{present:true,rect:rect(node),transparent:layers.every(layer=>layer.transparent),layers}]
      }))
      const side = rect(sidebar)
      const workspacePoints = side.width>60 && workspaceCoverage.header?.rect?.height>0 ? {
        header:[workspaceCoverage.header.rect.left+workspaceCoverage.header.rect.width*0.48,workspaceCoverage.header.rect.top+workspaceCoverage.header.rect.height/2],
        workspace:[workspaceCoverage.workspace.rect.right-30,workspaceCoverage.workspace.rect.top+workspaceCoverage.workspace.rect.height/2],
        session:[workspaceCoverage.session.rect.right-30,workspaceCoverage.session.rect.top+workspaceCoverage.session.rect.height/2],
        lowerList:[side.left+27,side.top+side.height*0.7],
        bottomFade:[side.left+27,workspaceCoverage.list.rect.bottom-5],
      } : null
      const style = document.querySelector('style[data-plugin="${ID}"]')
      style.disabled = true
      const undecorated = frame.getBoundingClientRect()
      style.disabled = false
      return { width:innerWidth,height:innerHeight,body:getComputedStyle(document.body).backgroundColor,
        ink:getComputedStyle(document.body).color,font:getComputedStyle(document.body).getPropertyValue('--dsw-font-family'),
        topHeight:m.height,topGrid:m.backgroundImage.includes('repeating-linear-gradient'),
        solidSidebar:getComputedStyle(column).backgroundColor==='rgb(16, 18, 34)' && getComputedStyle(column).backgroundImage==='none' && getComputedStyle(frame).backgroundImage==='none',
        divider:m.boxShadow.includes('rgb(255, 62, 165)'),
        captionBackground:getComputedStyle(document.querySelector('.closure-dsh-caption-probe')).backgroundColor,
        footerCovered:!!document.querySelector('.closure-dsh-footer'),
        sessionActionFill:getComputedStyle(document.querySelector('[data-slot="sidebar.session.action"] button')).backgroundColor,
        ambientPaint:getComputedStyle(document.querySelector('[data-slot="main.conversation"] > [data-phase]')).backgroundImage.includes('radial-gradient'),
        scanline:crt.backgroundImage.includes('repeating-linear-gradient'),crtPointer:crt.pointerEvents,
        inputHit:i.width>0 && document.elementFromPoint(i.left+10,i.top+8)===input,
        geometryUnchanged:original.width===undecorated.width && original.height===undecorated.height,
        overflow:document.documentElement.scrollWidth>innerWidth,
        workspaceCoverage,workspacePoints,sidebarWidth:side.width }
    })()`)
    assert.equal(value.body, 'rgb(10, 11, 22)')
    assert.equal(value.ink, 'rgb(238, 240, 255)')
    assert.match(value.font, /Cascadia Mono/)
    assert.equal(value.topHeight, '40px')
    for (const key of ['topGrid', 'solidSidebar', 'divider', 'footerCovered', 'scanline', 'ambientPaint', 'inputHit', 'geometryUnchanged']) assert.equal(value[key], true, `${width}: ${key}`)
    assert.equal(value.captionBackground,'rgba(0, 0, 0, 0)')
    assert.match(value.sessionActionFill, /^rgba\(/, 'Sidebar actions must let the solid surface show through')
    assert.equal(value.crtPointer, 'none')
    assert.equal(value.overflow, false)
    for (const [name,coverage] of Object.entries(value.workspaceCoverage)) {
      assert.equal(coverage.present,true,`${width}: real ${name} must be mounted`)
      assert.equal(coverage.transparent,true,`${width}: ${name} must reveal the solid sidebar surface`)
    }
    const filename = `desktop-${width}x${height}.png`
    const screenshot = await win.webContents.capturePage()
    const bitmap = screenshot.toBitmap(), imageSize = screenshot.getSize()
    const sx=imageSize.width/value.width, sy=imageSize.height/value.height
    const pixel = (x,y) => {
      const offset=(Math.floor(y*sy)*imageSize.width+Math.floor(x*sx))*4
      return [bitmap[offset+2],bitmap[offset+1],bitmap[offset]]
    }
    const corner = value.sidebarWidth>60 ? {
      above:pixel(27,38),below:pixel(27,42),divider:pixel(27,39),
    } : null
    if(corner){
      assert.ok(corner.divider[0]>150 && corner.divider[0]>corner.divider[1]*2, `Titlebar line over the sidebar: ${corner.divider}`)
      assert.ok(corner.above[2]>80 && corner.below[2]<55, 'The grid must end at the titlebar')
    }
    if (width === 1400) {
      const workspace = '.closure-dsh-sidebar [data-row-key^="workspace:"]'
      const folder = workspace + ' > span > svg[data-icon^="dsw-icon-folder-"]'
      for (const open of [true, false]) {
        await waitFor(`document.querySelector('${workspace}').getAttribute('aria-expanded') === '${open}'`)
        await checkFolder(win,folder,open)
        await evaluate(`document.querySelector('${workspace}').click()`)
      }
      await waitFor(`document.querySelector('[data-row-key^="session:"][aria-selected="true"]')`)
      await evaluate(`(() => {
        const sample = document.createElement('div')
        sample.id = 'code-samples'
        sample.style.cssText = 'position:fixed;top:90px;right:60px;width:380px;z-index:10'
        document.querySelector('[data-slot="main.conversation"]').append(sample)
        sample.unmount = window.__closureDshTest.mountCodeSamples(sample)
      })()`)
      for (const variant of ['first-child','last-child']) {
        const card = '#code-samples > .md-code-block:' + variant
        await checkCodePanel(win,{header:card+' [data-code-block-banner]',body:card,copy:card+' [data-code-block-banner] button:not([aria-pressed])'})
      }
      await evaluate("const sample=document.getElementById('code-samples');sample.unmount();sample.remove()")
      const selected = await evaluate(`(() => {
        const row = document.querySelector('[data-row-key^="session:"][aria-selected="true"]')
        const box = row.getBoundingClientRect(), paint = getComputedStyle(row)
        return {x:box.left + parseFloat(paint.borderLeftWidth) + 8,y:box.top + box.height/2}
      })()`)
      const [red, green, blue] = pixel(selected.x,selected.y)
      assert.ok(red>180 && green<95 && blue>115 && blue<red,'Selected session must have a visible magenta marker')
      const editor = '[data-composer-card] [contenteditable="true"]'
      await evaluate(`document.querySelector('${editor}').focus()`)
      await win.webContents.insertText('主题配色检查')
      await waitFor(`document.querySelector('[data-composer-card] button[class*="_primary"]:enabled')`)
      const editorPaint = await evaluate(`(() => {
        const card = document.querySelector('[data-composer-card]'), button = card.querySelector('button[class*="_primary"]:enabled')
        const focus = getComputedStyle(card).outline, ink = getComputedStyle(button).color
        const fill = getComputedStyle(button).backgroundColor
        document.activeElement.blur()
        return {focus,ink,fill,blurred:getComputedStyle(card).outlineStyle}
      })()`)
      assert.deepEqual(editorPaint,{focus:'rgb(153, 138, 185) solid 1px',ink:'rgb(16, 18, 34)',fill:'rgb(255, 62, 165)',blurred:'none'})
      await evaluate(`document.querySelector('${editor}').focus(); document.execCommand('selectAll'); document.execCommand('delete'); document.activeElement.blur()`)
    }
    const workspacePixels = Object.fromEntries(Object.entries(value.workspacePoints || {}).map(([name,point])=>[name,pixel(...point)]))
    for (const [name,rgb] of Object.entries(workspacePixels)) {
      assert.ok(rgb[2]<80 && rgb[0]<70 && rgb[1]<70,`${width}: ${name} must show dark sidebar paint, got ${rgb}`)
    }
    await fs.writeFile(path.join(output, filename), screenshot.toPNG())
    measurements.push({ filename, ...value, corner,workspacePixels })
    phase = `collapsed ${width}x${height}`
    await evaluate(`document.querySelector('[data-sidebar-toggle]').click()`)
    await waitFor(`document.querySelector('.closure-dsh-frame').hasAttribute('data-sidebar-collapsed')`)
    await delay(450)
    const collapsed = await evaluate(`(() => {
      const frame=document.querySelector('.closure-dsh-frame'),column=document.querySelector('.closure-dsh-sidebar-column')
      return {width:innerWidth,columnWidth:column.getBoundingClientRect().width,paintWidth:parseFloat(frame.style.getPropertyValue('--closure-dsh-menu-width')),
        grid:getComputedStyle(frame,'::before').backgroundImage.includes('repeating-linear-gradient'),on:document.documentElement.getAttribute('data-closure-dsh-theme'),overflow:document.documentElement.scrollWidth>innerWidth}
    })()`)
    assert.ok(collapsed.columnWidth<1,`${width}: native Windows sidebar must collapse fully`)
    assert.equal(collapsed.paintWidth,collapsed.columnWidth)
    assert.equal(collapsed.grid,true)
    assert.equal(collapsed.on,'on')
    assert.equal(collapsed.overflow,false)
    await fs.writeFile(path.join(output, `collapsed-${width}x${height}.png`),(await win.webContents.capturePage()).toPNG())
    collapsedMeasurements.push(collapsed)
  }
  phase = 'settings and routing'
  win.setSize(1400, 900)
  await delay(400)
  // Opening the native settings modal and global plugin page must keep the
  // caption, palette and CRT continuously mounted across routing.
  await evaluate(`window.__closureFrames=[];window.__closureMeasure=true;
    (function tick(){if(!window.__closureMeasure)return;window.__closureFrames.push({on:document.documentElement.getAttribute('data-closure-dsh-theme'),grid:getComputedStyle(document.querySelector('.closure-dsh-frame'),'::before').backgroundImage.includes('repeating-linear-gradient')});requestAnimationFrame(tick)})()`)
  const settingsModifiers = [process.platform === 'darwin' ? 'meta' : 'control', 'alt']
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: ',', modifiers: settingsModifiers })
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: ',', modifiers: settingsModifiers })
  await waitFor(`!!document.querySelector('[data-shortcut-modal=settings]')`)
  await delay(350)
  await fs.writeFile(path.join(output, 'settings.png'), (await win.webContents.capturePage()).toPNG())
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
  await waitFor(`!document.querySelector('[data-shortcut-modal=settings]')`)
  await evaluate(`document.querySelector('.closure-dsh-navigation button')?.click()`)
  await delay(650)
  const continuity = await evaluate(`window.__closureMeasure=false;({samples:window.__closureFrames.length,stable:window.__closureFrames.every(f=>f.on==='on'&&f.grid),text:document.body.innerText.slice(0,700)})`)
  assert.ok(continuity.samples > 4)
  assert.equal(continuity.stable, true)
  await fs.writeFile(path.join(output, 'plugins.png'), (await win.webContents.capturePage()).toPNG())
  await waitFor(`!!window.__closureDshTest`)
  phase = 'disable and restore'
  await evaluate(`window.__closureDshTest.enable(false)`)
  const released = await evaluate(`({attribute:document.documentElement.hasAttribute('data-closure-dsh-theme'),
    classes:document.querySelectorAll('[class*=closure-dsh]').length,
    sheets:document.querySelectorAll('style[data-plugin="${ID}"]').length,
    variables:document.querySelector('[style*="--closure-dsh-"]')!==null,
    registered:window.__closureDshTest.theme.getTheme().themes.some(t=>t.id==='${ID}')})`)
  assert.deepEqual(released, { attribute: false, classes: 0, sheets: 0, variables: false, registered: false })
  await evaluate(`window.__closureDshTest.theme.setTheme('light')`)
  await delay(250)
  const original = await evaluate(`({background:getComputedStyle(document.body).backgroundColor, preference:window.__closureDshTest.theme.getTheme().preference})`)
  assert.equal(original.preference, 'light')
  await evaluate(`window.__closureDshTest.enable(true)`)
  await waitFor(`document.documentElement.getAttribute('data-closure-dsh-theme')==='on'`)
  await evaluate(`document.querySelector('.closure-dsh-frame').classList.remove('closure-dsh-frame');document.querySelector('.closure-dsh-sidebar').classList.remove('closure-dsh-sidebar')`)
  await waitFor(`document.querySelector('.closure-dsh-frame') && document.querySelector('.closure-dsh-sidebar')`)
  await evaluate(`window.__closureDshTest.enable(false)`)
  await delay(250)
  const restored = await evaluate(`({background:getComputedStyle(document.body).backgroundColor,preference:window.__closureDshTest.theme.getTheme().preference})`)
  assert.deepEqual(restored, original)
  phase = 'reload'
  await evaluate(`window.__closureDshTest.enable(true)`)
  await win.reload()
  await waitFor(`!!document.querySelector('.closure-dsh-navigation')`)
  const reloaded = await evaluate(`document.querySelectorAll('style[data-plugin="${ID}"]').length===1 && document.documentElement.getAttribute('data-closure-dsh-theme')==='on'`)
  assert.equal(reloaded, true)
  assert.equal(win.isVisible(), false)
  assert.deepEqual(errors, [])
  let layoutBaseline = null
  if (layoutNotices.length) {
    layoutBaseline = JSON.parse(await fs.readFile(path.join(output,'baseline-layout.json'),'utf8'))
    assert.equal(layoutBaseline.pluginEnabled,false)
    assert.deepEqual(layoutBaseline.errors,[])
    assert.ok(layoutNotices.length<=layoutBaseline.layoutNotices.length,'Theme must not add resize notices beyond the unmodified host baseline')
    assert.ok(layoutNotices.every(notice=>notice.phase==='expanded 600x720' && layoutBaseline.layoutNotices.some(item=>item.message===notice.message && item.phase==='unmodified DSH 600x720')))
  }
  const plugin = {id:ID,version:require('../plugins/dsh-closure-codex-theme/package.json').version}
  const report = { passed: true, scope: 'Real isolated DSH 0.2.2-rc.5 Web host with Windows titlebar markers and the native colour swatch; hidden, unfocusable offscreen window; current native application not activated or manipulated', plugin, boot, measurements, collapsedMeasurements, continuity, released, restored, reloaded, errors, layoutNotices, layoutBaseline }
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ passed: true, samples: measurements.length, continuity: continuity.samples, reloaded, errors }))
  app.exit(0)
}).catch(error => { console.error(error); app.exit(1) })
setTimeout(() => app.exit(2), 45000).unref()
