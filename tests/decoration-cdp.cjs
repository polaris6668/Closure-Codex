// Hidden app-protocol fixture: verifies the production new-document payload, not just the preview.
const { app,BrowserWindow,protocol } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const {checkFolder, checkCodePanel} = require('./theme-detail-checks.cjs')
const packageRoot=process.env.CLOSURE_TEST_PACKAGE_ROOT || path.resolve(__dirname,'..')
const { buildPayload } = require(path.join(packageRoot,'outputs/closure-decoration/renderer-payload.cjs'))
const { validateEndpoint } = require(path.join(packageRoot,'outputs/closure-decoration/cdp.cjs'))
const { hasProfile } = require(path.join(packageRoot,'outputs/closure-decoration/official-runtime.cjs'))
const output=process.env.CLOSURE_TEST_OUTPUT || path.resolve(__dirname,'../work/decoration-cdp')
app.setPath('userData',path.join(output,'profile'))
protocol.registerSchemesAsPrivileged([{scheme:'app',privileges:{standard:true,secure:true}}])
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))
const threads = `<div data-app-action-sidebar-thread-row aria-current="page">First thread</div>
  <div data-app-action-sidebar-thread-row data-app-action-sidebar-thread-selected="true">Another thread</div>`
const composer = `<div data-composer-surface-variant="default" style="border-radius:22px">
  <input data-codex-composer aria-label="Message"><div data-composer-trailing-controls>
  <button type="button" class="size-token-button-composer" aria-label="发送"><span class="text-composer-primary">↑</span></button></div></div>`
const shell=id=>`<section id="${id}" data-app-shell-frame data-app-shell-page-surface="true" data-app-shell-active-page="true"><div class="menu"><div><button id="application-menu-trigger-file-menu">File</button></div></div><header data-app-shell-titlebar><button>Chat tab</button></header><div class="app-shell-left-panel"><nav data-app-navigation-rail="true" style="width:52px;height:120px;background-color:#181818"><button aria-label="Home">Home</button></nav><nav class="sidebar-navigation" data-sidebar-navigation-root>${threads}</nav></div><main data-app-shell-main-surface="default">${composer}</main></section>`
// A native default appearance, with none of the project's theme imported.
const html=`<!doctype html><html data-theme="system" data-codex-window-type="electron" data-codex-window-chrome="application-menu"><head><style>body{margin:0;background:var(--color-surface,white);color:var(--color-text-primary,black)}.menu{height:36px}header{height:46px}main{height:400px}.app-shell-left-panel{position:relative;--app-shell-titlebar-height:8px;--app-shell-navigation-rail-width:52px;background:#181818}.sidebar-navigation{background:#242424}html[data-codex-window-type="electron"] [data-app-shell-frame][data-app-shell-page-surface="true"] [data-sidebar-navigation-root]{background-color:initial!important}[data-app-shell-active-page="false"]{display:none}</style></head><body><div data-app-shell-active-page="false"><header data-app-shell-titlebar id="inactive"></header><main data-app-shell-main-surface></main></div>${shell('first')}</body></html>`
app.whenReady().then(async()=>{
  await fs.mkdir(output,{recursive:true})
  protocol.handle('app',()=>new Response(html,{headers:{'content-type':'text/html; charset=utf-8'}}))
  const payload=await buildPayload()
  const win=new BrowserWindow({show:false,focusable:false,skipTaskbar:true,webPreferences:{offscreen:true,backgroundThrottling:false,sandbox:true,contextIsolation:true,nodeIntegration:false}})
  await win.loadURL('about:blank')
  win.webContents.debugger.attach('1.3')
  await win.webContents.debugger.sendCommand('Page.enable')
  const {identifier}=await win.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument',{source:payload})
  await win.loadURL('app://-/index.html')
  await delay(300)
  const evaluate=source=>win.webContents.executeJavaScript(source)
  const {revision,...mounted}=await evaluate('window.__closurePageDecoration.snapshot()')
  assert.match(revision,/^[a-f0-9]{16}$/)
  assert.deepEqual(mounted,{installed:true,shellReady:true,parts:{titlebar:true,workspace:true,sidebar:true}})
  assert.equal(await evaluate('document.documentElement.dataset.theme'),'dark')
  assert.equal(await evaluate('getComputedStyle(document.body).backgroundColor'),'rgb(10, 11, 22)')
  assert.equal(await evaluate('getComputedStyle(document.body).color'),'rgb(238, 240, 255)')
  for (const selector of ['.app-shell-left-panel', '.sidebar-navigation', '[data-app-navigation-rail]']) {
    const paint = await evaluate(`(() => { const s=getComputedStyle(document.querySelector(${JSON.stringify(selector)}));return [s.backgroundColor,s.backgroundImage] })()`)
    assert.deepEqual(paint,['rgb(16, 18, 34)','none'],selector)
  }
  for (const token of ['--app-shell-sidebar-docked-background', '--color-token-side-bar-background']) {
    assert.equal(await evaluate(`getComputedStyle(document.documentElement).getPropertyValue(${JSON.stringify(token)}).trim()`), '#101222', token)
  }
  assert.ok((await evaluate('getComputedStyle(document.documentElement).getPropertyValue("--font-code-family")')).includes('Cascadia Mono'))
  const corner=await evaluate(`(()=>{const s=getComputedStyle(document.querySelector('.app-shell-left-panel'),'::before');return {content:s.content,top:s.top,width:s.width,height:s.height,color:s.backgroundColor,image:s.backgroundImage,pointer:s.pointerEvents}})()`)
  assert.equal(corner.content,'""');assert.equal(corner.top,'-8px');assert.equal(corner.width,'52px');assert.equal(corner.height,'8px');assert.equal(corner.pointer,'none')
  assert.equal(corner.color,'rgb(16, 18, 34)');assert.equal(corner.image,'none')
  assert.equal(await evaluate('document.querySelector("#inactive").classList.length'),0)
  const duplicate=await evaluate(payload)
  assert.equal(duplicate.shellReady,true)
  assert.equal(await evaluate('document.querySelectorAll("#closure-page-decoration-style").length'),1)
  const layout=await evaluate(`(() => {
    const header=document.querySelector('#first .menu'), input=document.querySelector('input')
    const before=header.getBoundingClientRect().height
    const background=getComputedStyle(header).backgroundImage
    const rect=input.getBoundingClientRect()
    const hit=document.elementFromPoint(rect.x+5,rect.y+5)===input
    const crt=getComputedStyle(document.documentElement,'::before')
    const menuButton=document.querySelector('#application-menu-trigger-file-menu'), m=menuButton.getBoundingClientRect()
    return {height:before,background,divider:getComputedStyle(header).boxShadow,hit,menuY:header.getBoundingClientRect().y,
      tabDecorated:document.querySelector('#first header').classList.contains('closure-decoration-titlebar'),
      menuHit:document.elementFromPoint(m.x+3,m.y+3)===menuButton,crt:crt.backgroundImage,crtPointer:crt.pointerEvents}
  })()`)
  assert.equal(layout.height,36);assert.equal(layout.hit,true)
  assert.ok(layout.background.includes('repeating-linear-gradient'))
  assert.ok(layout.divider.includes('rgb(255, 62, 165) 0px -1px'))
  assert.equal(layout.menuY,0);assert.equal(layout.tabDecorated,false);assert.equal(layout.menuHit,true)
  assert.ok(layout.crt.includes('repeating-linear-gradient') && layout.crt.includes('radial-gradient'))
  assert.equal(layout.crtPointer,'none')
  await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true})
  const interaction = await evaluate(`(() => {
    const [current, other] = document.querySelectorAll('[data-app-action-sidebar-thread-row]')
    const marker = row => getComputedStyle(row).backgroundImage
    const initial = [marker(current), marker(other)]
    current.removeAttribute('aria-current')
    other.setAttribute('aria-current', 'page')
    const field = document.querySelector('[data-composer-surface-variant]'), input = field.querySelector('input')
    const button = field.querySelector('button'), glyph = button.firstElementChild
    const before = field.getBoundingClientRect()
    input.focus()
    const focus = getComputedStyle(field).outline
    button.focus()
    const blurred = getComputedStyle(field).outlineStyle
    const isMagenta = () => getComputedStyle(button).backgroundColor === 'rgb(255, 62, 165)'
    const ink = getComputedStyle(glyph).color
    const labels = ['发送','Queue','引导','停止','Resume'].map(label => {button.setAttribute('aria-label',label); return isMagenta()})
    button.setAttribute('aria-label','Send')
    button.disabled = true
    const disabled = isMagenta()
    button.disabled = false
    button.setAttribute('aria-disabled','true')
    const ariaDisabled = isMagenta()
    button.removeAttribute('aria-disabled')
    button.setAttribute('aria-busy','true')
    return {initial, switched:[marker(current), marker(other)], size:getComputedStyle(other).backgroundSize,
      focus, blurred, radius:getComputedStyle(field).borderRadius, stable:field.getBoundingClientRect().height === before.height,
      ink, labels, disabled, ariaDisabled, busy:isMagenta()}
  })()`)
  const magentaMarker='linear-gradient(rgb(255, 62, 165), rgb(255, 62, 165))'
  assert.deepEqual(interaction,{initial:[magentaMarker,'none'],switched:['none',magentaMarker],size:'2px 16px',
    focus:'rgb(153, 138, 185) solid 1px',blurred:'none',radius:'22px',stable:true,ink:'rgb(16, 18, 34)',
    labels:[true,true,true,false,false],disabled:false,ariaDisabled:false,busy:false})
  // The new-thread page paints the body and places the utility bar below it.
  const homeComposer = `<div data-composer-surface-variant="default" data-composer-utility-bar-variant="home">
    <div data-composer-body style="border-radius:9999px;padding:8px;background:#181924">
      <div data-codex-composer contenteditable="true"></div>
    </div><button type="button">Choose project</button></div>`
  await evaluate(`document.querySelector('#first main').insertAdjacentHTML('beforeend',${JSON.stringify(homeComposer)})`)
  const homeFocus = await evaluate(`(() => {
    const outer = document.querySelector('[data-composer-utility-bar-variant="home"]')
    const body = outer.querySelector('[data-composer-body]'), editor = body.firstElementChild
    const paint = () => [getComputedStyle(outer).outlineStyle, getComputedStyle(body).outlineStyle,
      getComputedStyle(body).outlineColor, getComputedStyle(body).borderRadius]
    editor.focus()
    const empty = paint()
    editor.innerText = 'First line\\nSecond line'
    body.style.borderRadius = '22px'
    const multiline = paint()
    outer.querySelector('button').focus()
    const toolbar = [getComputedStyle(outer).outlineStyle, getComputedStyle(body).outlineStyle]
    outer.remove()
    return {empty, multiline, toolbar}
  })()`)
  assert.deepEqual(homeFocus,{
    empty:['none','solid','rgb(153, 138, 185)','9999px'],
    multiline:['none','solid','rgb(153, 138, 185)','22px'],
    toolbar:['none','none'],
  })
  const projects = `<div id="project" data-app-action-sidebar-project-row aria-expanded="false">
    <span data-sidebar-project-kind="local" data-sidebar-project-drop-zone="project-icon"><svg width="16" height="16"><path d="M1 1h14v14z"/></svg></span>
    <button aria-label="More"><svg width="16" height="16"></svg></button></div>
    <div data-app-action-sidebar-project-row aria-expanded="true"><span data-sidebar-project-kind="local" data-sidebar-project-drop-zone="project-icon">
    <span><svg id="custom-icon" width="16" height="16"></svg></span></span></div>`
  const code = `<div data-markdown-text-style="assistant-message"><div data-code-block>
    <div data-markdown-copy="exclude"><span>PowerShell</span><div data-code-block-controls>
    <button aria-label="Copy code">Copy</button></div></div><div data-code-block-source><pre><code>Get-Date</code></pre></div></div></div>`
  await evaluate(`document.querySelector('.sidebar-navigation').insertAdjacentHTML('beforeend',${JSON.stringify(projects)});
    document.querySelector('#first main').insertAdjacentHTML('beforeend',${JSON.stringify(code)})`)
  const folder = '#project [data-sidebar-project-kind] > svg'
  await checkFolder(win, folder, false)
  await evaluate("document.querySelector('#project').setAttribute('aria-expanded', 'true')")
  await checkFolder(win, folder, true)
  assert.ok(await evaluate(`['#custom-icon','#project button svg'].every(s => getComputedStyle(document.querySelector(s)).backgroundImage === 'none')`))
  await checkCodePanel(win,{header:'[data-code-block] > [data-markdown-copy]',body:'[data-code-block]',copy:'[data-code-block-controls] button'})
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'forced-colors',value:'active'}]})
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('${folder} > path')).visibility`),'visible')
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('${folder}')).backgroundImage`),'none')
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[]})
  await evaluate(`window.__closurePageDecoration.revision='old'`)
  assert.equal((await evaluate(payload)).revision,revision)
  assert.equal(await evaluate('document.querySelectorAll("#closure-page-decoration-style").length'),1)
  assert.equal(await evaluate('getComputedStyle(document.documentElement).getPropertyValue("--closure-crt-shade").trim()'),'rgb(8 8 16 / 26%)')
  await evaluate(`document.querySelector('#first').outerHTML=${JSON.stringify(shell('second'))}`)
  await delay(300)
  assert.equal(await evaluate('document.querySelector("#second .menu").classList.contains("closure-decoration-titlebar")'),true)
  await evaluate(`document.querySelector('#second .menu').className='menu'`)
  await delay(300)
  assert.equal(await evaluate('document.querySelector("#second .menu").classList.contains("closure-decoration-titlebar")'),true)
  await evaluate(`document.querySelector('#second').setAttribute('data-app-shell-active-page','false')`)
  await delay(300)
  assert.equal(await evaluate('window.__closurePageDecoration.snapshot().shellReady'),false)
  assert.notEqual(await evaluate('getComputedStyle(document.documentElement,"::before").content'),'none')
  await evaluate(`document.querySelector('#second').setAttribute('data-app-shell-active-page','true');document.getElementById('closure-page-decoration-style').remove()`)
  await delay(300)
  assert.equal(await evaluate('window.__closurePageDecoration.snapshot().shellReady'),true)
  assert.equal(await evaluate('document.querySelectorAll("#closure-page-decoration-style").length'),1)
  const routeContinuity=await evaluate(`(async()=>{
    const root=document.documentElement,menu=document.querySelector('#second .menu'),baseline=getComputedStyle(menu).backgroundImage
    let frames=0,changed=0
    const observe=()=>{frames++;const m=document.querySelector('.menu'),rail=document.querySelector('[data-app-navigation-rail]');if(root.dataset.closureDecoration!=='on'||root.dataset.theme!=='dark'||(m&&getComputedStyle(m).backgroundImage!==baseline)||(rail&&getComputedStyle(rail).backgroundColor!=='rgb(16, 18, 34)'))changed++}
    const frame=()=>new Promise(resolve=>requestAnimationFrame(()=>{observe();resolve()}))
    const changes=[]
    const watcher=new MutationObserver(records=>changes.push(...records.map(r=>({name:r.attributeName,old:r.oldValue}))))
    watcher.observe(root,{attributes:true,attributeOldValue:true,attributeFilter:['data-closure-decoration','data-theme']})
    for(let n=0;n<6;n++) {
      const main=document.querySelector('#second main,[data-settings-panel]')
      main?.remove()
      await frame() // Route gap: menu row remains, work surface is temporarily absent.
      const settings=document.createElement('div');settings.setAttribute('data-settings-panel','')
      document.querySelector('#second').appendChild(settings)
      await frame()
      const old=document.querySelector('#second')
      old.outerHTML=${JSON.stringify(shell('second'))}
      observe() // CSS already paints the replacement row before the observer has run.
      await frame()
    }
    document.querySelector('#second').remove()
    await frame() // A whole shell can be replaced between frames without disabling document colours.
    document.body.insertAdjacentHTML('beforeend',${JSON.stringify(shell('second'))})
    observe();await frame()
    watcher.disconnect()
    return {frames,changed,rootAppearanceChanges:changes.length}
  })()`)
  assert.equal(routeContinuity.changed,0,JSON.stringify(routeContinuity))
  assert.equal(routeContinuity.rootAppearanceChanges,0,JSON.stringify(routeContinuity))
  assert.ok(routeContinuity.frames>=20)
  await win.webContents.debugger.sendCommand('Page.reload')
  await delay(600)
  assert.equal(await evaluate('window.__closurePageDecoration.snapshot().shellReady'),true)
  await win.webContents.debugger.sendCommand('Page.removeScriptToEvaluateOnNewDocument',{identifier})
  await evaluate('window.__closurePageDecoration.dispose()')
  assert.equal(await evaluate('document.documentElement.dataset.theme'),'system')
  assert.equal(await evaluate('getComputedStyle(document.body).backgroundColor'),'rgb(255, 255, 255)')
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".app-shell-left-panel")).backgroundColor'),'rgb(24, 24, 24)')
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".sidebar-navigation")).backgroundColor'),'rgba(0, 0, 0, 0)')
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".app-shell-left-panel"),"::before").content'),'none')
  assert.equal(await evaluate('getComputedStyle(document.querySelector("[data-app-navigation-rail]")).backgroundImage'),'none')
  assert.equal(await evaluate('getComputedStyle(document.querySelector("[data-app-navigation-rail]")).backgroundColor'),'rgb(24, 24, 24)')
  assert.equal(await evaluate('!!window.__closurePageDecoration || !!document.querySelector("[class*=closure-decoration-],#closure-page-decoration-style,[data-closure-decoration],[data-closure-pending]")'),false)
  await win.webContents.debugger.sendCommand('Page.reload');await delay(300)
  assert.equal(await evaluate('!!window.__closurePageDecoration'),false)
  assert.equal(win.isVisible(),false)
  for(const endpoint of ['ws://0.0.0.0:19336/devtools/page/test','ws://127.0.0.1:9335/devtools/page/test','ws://127.0.0.1:19336/devtools/page/test?q=1'])assert.throws(()=>validateEndpoint(endpoint,19336))
  assert.equal(validateEndpoint('ws://127.0.0.1:19336/devtools/browser/id-1',19336),'ws://127.0.0.1:19336/devtools/browser/id-1')
  const profile='C:\\测试 path\\profile'
  assert.ok(hasProfile(`exe "--user-data-dir=${profile}" --flag`,profile))
  assert.ok(hasProfile(`exe --user-data-dir="${profile}" --flag`,profile))
  assert.ok(!hasProfile(`exe "--user-data-dir=${profile}-other"`,profile))
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify({passed:true,scope:'Hidden app-protocol fixture, not authenticated Codex',routeContinuity,checks:['document-start injection','menu row rather than chat tabs','sidebar and navigation rail share a solid background','inactive routes','idempotence','input and layout','dark CRT scanlines and vignette','revision hot replacement','SPA replacement','class replacement repair','style repair','route gaps and menu replacement without appearance reset','reload','full disposal','endpoint and profile validation']},null,2))
  console.log('Production CDP payload: fixture checks passed')
  app.exit(0)
}).catch(error=>{console.error(error);app.exit(1)})
setTimeout(()=>app.exit(2),30000).unref()
