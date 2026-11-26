// Actual installed WorkBuddy renderer, with a synthetic offline host and data.
// Test windows are hidden/offscreen. No account, chat or native window is used.
const {app,BrowserWindow}=require('electron')
const assert=require('node:assert/strict')
const fs=require('node:fs/promises')
const path=require('node:path')
const {spawn}=require('node:child_process')
const {checkFolder,checkCodePanel}=require('./theme-detail-checks.cjs')
const root=path.resolve(__dirname,'..')
const packageRoot=process.env.CLOSURE_TEST_PACKAGE_ROOT||root
const output=process.env.CLOSURE_TEST_OUTPUT||path.join(root,'work/workbuddy-theme/verification')
const plugin=path.join(packageRoot,'plugins/workbuddy-closure-codex-theme')
const renderer=process.env.CLOSURE_WB_RENDERER
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))
app.setPath('userData',path.join(output,'profile'))
app.commandLine.appendSwitch('disable-background-networking')
app.commandLine.appendSwitch('remote-debugging-address','127.0.0.1')
app.commandLine.appendSwitch('remote-debugging-port','0')
let helper
app.whenReady().then(async()=>{
  await fs.mkdir(output,{recursive:true})
  const win=new BrowserWindow({width:1400,height:900,show:false,focusable:false,skipTaskbar:true,
    webPreferences:{offscreen:true,backgroundThrottling:false,sandbox:true,contextIsolation:true}})
  const errors=[],diagnostics=[]
  win.webContents.on('console-message',(event,...rest)=>{
    const details=typeof rest[0]==='number'?{level:rest[0],message:rest[1]}:event
    if(details.level==='error'||details.level===3){
      if(/logger isn't initialized|\[cl-diag|\[query-rec-lang\]/.test(details.message))diagnostics.push(details.message)
      else errors.push(details.message)
    }
  })
  const remoteRequests=[]
  win.webContents.session.webRequest.onBeforeRequest((details,callback)=>{
    const allowed=['file:','data:','blob:','about:'].includes(new URL(details.url).protocol)
    if(!allowed)remoteRequests.push(new URL(details.url).origin)
    callback({cancel:!allowed})
  })
  await win.loadURL('about:blank')
  win.webContents.debugger.attach('1.3')
  await win.webContents.debugger.sendCommand('Page.enable')
  await win.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument',{source:await fs.readFile(path.join(__dirname,'workbuddy-theme-fixture.cjs'),'utf8')})
  const evaluate=source=>win.webContents.executeJavaScript(source)
  async function waitFor(source){
    for(let n=0;n<150;n++){if(await evaluate(`Boolean(${source})`))return;await delay(100)}
    await fs.writeFile(path.join(output,'failure.png'),(await win.webContents.capturePage()).toPNG())
    throw Error('Timed out: '+source+'; errors: '+errors.map(e=>e.slice(0,250)).join('\n'))
  }
  await win.loadFile(renderer)
  await waitFor(`document.querySelector('[contenteditable=true]') && document.body.innerText.includes('主题工作区')`)
  await delay(250)
  const baseline=await evaluate(`({kind:document.body.getAttribute('data-vscode-theme-kind'),mode:document.documentElement.getAttribute('data-theme'),source:document.body.getAttribute('data-theme-source'),preferences:JSON.stringify({...localStorage})})`)
  let debug
  for(let n=0;n<30;n++){debug=await fs.readFile(path.join(output,'profile/DevToolsActivePort'),'utf8').catch(()=>null);if(debug)break;await delay(100)}
  const [port,browserPath]=debug.trim().split(/\r?\n/)
  const state=path.join(output,'helper.json'),control=path.join(output,'control.json')
  await fs.unlink(control).catch(()=>{})
  const env={...process.env,ELECTRON_RUN_AS_NODE:'1'}
  helper=spawn(process.execPath,[path.join(plugin,'lib/attach.cjs'),'--port',port,'--browser',`ws://127.0.0.1:${port}${browserPath}`,'--renderer',renderer,'--state',state,'--control',control],{windowsHide:true,stdio:['ignore','pipe','pipe'],env})
  let helperErrors=''
  helper.stderr.on('data',data=>{helperErrors+=data})
  await waitFor(`document.documentElement.getAttribute('data-closure-workbuddy-theme')==='on'`)
  const measurements=[]
  for(const [width,height]of [[1400,900],[1000,720],[800,650]]){
    win.setSize(width,height);await delay(400)
    const value=await evaluate(`(() => {
      const side=document.querySelector('[data-view-id=sidebar]'),input=document.querySelector('[contenteditable=true]')
      const list=document.querySelector('.conversation-list'),menu=document.querySelector('#workbuddy-menubar-container')
      const b=side.getBoundingClientRect(),i=input.getBoundingClientRect(),sheet=document.querySelector('style[data-plugin=workbuddy-closure-codex-theme]')
      const native={side:[b.width,b.height],input:[i.width,i.height]}
      sheet.disabled=true;const plain={side:[side.getBoundingClientRect().width,side.getBoundingClientRect().height],input:[input.getBoundingClientRect().width,input.getBoundingClientRect().height]};sheet.disabled=false
      return {width:innerWidth,height:innerHeight,sideWidth:b.width,sideBottom:b.bottom,font:getComputedStyle(document.body).fontFamily,
        mode:document.documentElement.getAttribute('data-theme'),source:document.body.getAttribute('data-theme-source'),
        listBackground:getComputedStyle(list).backgroundColor,listImage:getComputedStyle(list).backgroundImage,
        solidSidebar:getComputedStyle(side).backgroundImage==='none' && getComputedStyle(side).backgroundColor==='rgb(16, 18, 34)',topGrid:getComputedStyle(menu).backgroundImage.includes('repeating-linear-gradient'),
        crt:getComputedStyle(document.documentElement,'::before').pointerEvents,inputHit:input.contains(document.elementFromPoint(i.left+10,i.top+12)),
        ink:getComputedStyle(input).color,composer:getComputedStyle(document.querySelector('.cr-input-container')).backgroundColor,
        geometryUnchanged:JSON.stringify(native)===JSON.stringify(plain),overflow:document.documentElement.scrollWidth>innerWidth,
        rows:document.querySelectorAll('[data-conversation-id]').length,text:document.body.innerText.slice(0,500)}
    })()`)
    assert.equal(value.mode,'dark');assert.equal(value.source,'dark');assert.match(value.font,/Cascadia Mono/)
    assert.equal(value.listBackground,'rgba(0, 0, 0, 0)');assert.equal(value.listImage,'none')
    for(const key of ['solidSidebar','topGrid','inputHit','geometryUnchanged'])assert.equal(value[key],true,`${width}: ${key}`)
    assert.equal(value.crt,'none');assert.equal(value.overflow,false)
    assert.ok(value.text.includes('主题工作区')&&value.text.includes('主题适配验收'))
    const shot=await win.webContents.capturePage(),bitmap=shot.toBitmap(),size=shot.getSize()
    const pixel=(x,y)=>{const offset=(Math.floor(y*size.height/value.height)*size.width+Math.floor(x*size.width/value.width))*4;return[bitmap[offset+2],bitmap[offset+1],bitmap[offset]]}
    value.pixels={cornerTop:pixel(7,27),divider:pixel(7,29),cornerBelow:pixel(7,33),sidebarMiddle:pixel(7,400),sidebarBottom:pixel(7,value.height-20),caption:pixel(value.width-7,15)}
    for(const name of ['cornerTop','caption']){
      const rgb=value.pixels[name]
      assert.ok(rgb[2]>80 && rgb[2]>rgb[0]*1.6,`${width}: ${name} must show the blue titlebar, got ${rgb}`)
    }
    for(const name of ['cornerBelow','sidebarMiddle','sidebarBottom']){
      const rgb=value.pixels[name]
      assert.ok(rgb[2]<55 && rgb[0]<35 && rgb[1]<35,`${width}: ${name} must show the dark sidebar, got ${rgb}`)
    }
    assert.ok(value.pixels.divider[0]>150 && value.pixels.divider[0]>value.pixels.divider[1]*2,`Missing titlebar line at left: ${value.pixels.divider}`)
    await fs.writeFile(path.join(output,`desktop-${width}x${height}.png`),shot.toPNG())
    measurements.push(value)
  }
  win.setSize(1400,900);await delay(300)
  const workspace='.flat-subfolder-row[data-flat-row-id^="grouped-sub-workdir:"]'
  const workspaceHeader=workspace+' .collapsible-section-header'
  for(const open of [true,false]){
    await waitFor(`!!document.querySelector('${workspace} .collapsible-section-motion--expanded') === ${open}`)
    await checkFolder(win,workspaceHeader+' .collapsible-section-icon > svg',open)
    await evaluate(`document.querySelector('${workspaceHeader}').click()`)
  }
  await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true})
  const codeSample=`<div id="code-sample" style="position:fixed;top:90px;right:60px;width:380px;z-index:10">
    <div class="cr-code-like-box"><div class="cr-code-like-box__header"><span class="cr-code-block__language">powershell</span>
    <button class="cr-code-block__copy-button" aria-label="复制">⧉</button></div>
    <div class="cr-code-like-box__content"><pre class="cr-code-block__pre"><code>Get-Date</code></pre></div></div></div>`
  await evaluate(`document.body.insertAdjacentHTML('beforeend',${JSON.stringify(codeSample)})`)
  await checkCodePanel(win,{header:'#code-sample .cr-code-like-box__header',body:'#code-sample .cr-code-like-box',copy:'#code-sample button'})
  await evaluate("document.querySelector('#code-sample').remove()")
  const conversationCard='.conversation-list .cb-agent-card'
  for (const id of ['closure-theme-test','closure-theme-switch-test']) {
    const card=conversationCard+'[data-conversation-id="'+id+'"]'
    await evaluate(`document.querySelector('${card}').click()`)
    await waitFor(`document.querySelector('${card}[data-selected="true"]')`)
    const mark=await evaluate(`(() => {
      const row=document.querySelector('${card}'),paint=getComputedStyle(row)
      const others=[...document.querySelectorAll('${conversationCard}[data-conversation-id]')].filter(item=>item.dataset.conversationId!==row.dataset.conversationId)
      return {size:paint.backgroundSize,image:paint.backgroundImage,
        othersClear:others.length>0 && others.every(item=>getComputedStyle(item).backgroundImage==='none')}
    })()`)
    assert.equal(mark.size,'2px 16px')
    assert.match(mark.image,/rgb\(255, 62, 165\)/)
    assert.equal(mark.othersClear,true,'Only the current conversation should show the marker')
    // The selected row can move while the workspace group animates open.
    let matchingFrames=0
    let sample
    for(let frame=0;frame<45 && matchingFrames<2;frame++){
      const point=await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>{
        const box=document.querySelector('${card}').getBoundingClientRect()
        resolve({x:Math.floor(box.left+5),y:Math.floor(box.top+box.height/2)})
      }))`)
      const chip=await win.webContents.capturePage({...point,width:1,height:1})
      const [blue,green,red]=chip.toBitmap()
      sample={...point,red,green,blue}
      matchingFrames=red>180 && green<95 && blue>115 && blue<red ? matchingFrames+1 : 0
    }
    assert.equal(matchingFrames,2,`Selected card ${id} must paint its magenta marker: ${JSON.stringify(sample)}`)
  }
  await win.reload()
  await waitFor(`document.querySelector('[contenteditable=true]') && document.body.innerText.includes('主题工作区') && document.documentElement.getAttribute('data-closure-workbuddy-theme')==='on'`)
  const reloaded=await evaluate(`document.querySelectorAll('style[data-plugin=workbuddy-closure-codex-theme]').length===1`)
  assert.equal(reloaded,true)
  await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true})
  const editor="document.querySelector('.cr-input-container [contenteditable=true]')"
  const composerStyle=`getComputedStyle(${editor}.closest('.cr-input-container'))`
  await evaluate(`${editor}.focus()`)
  await waitFor(`document.activeElement === ${editor} && ${composerStyle}.borderTopColor === 'rgb(153, 138, 185)'`)
  assert.ok(await evaluate(`parseFloat(${composerStyle}.borderRadius)>0`),'The focused composer keeps its rounded corners')
  await win.webContents.insertText('主题验收草稿，不发送')
  await delay(200)
  const draft=await evaluate(`document.querySelector('[contenteditable=true]').textContent`)
  assert.ok(draft.includes('主题验收草稿'))
  const menuPoint=await evaluate(`(() => {const b=document.querySelector('.menubar-menu-button').getBoundingClientRect();return{x:Math.round(b.x+b.width/2),y:Math.round(b.y+b.height/2)}})()`)
  win.webContents.sendInputEvent({type:'mouseDown',...menuPoint,button:'left',clickCount:1})
  win.webContents.sendInputEvent({type:'mouseUp',...menuPoint,button:'left',clickCount:1})
  await waitFor(`document.querySelector('.codebuddy-menu-container .menu-item')`)
  await waitFor(`document.activeElement !== ${editor} && ${composerStyle}.borderTopColor !== 'rgb(153, 138, 185)'`)
  await delay(250)
  const menuPaint=await evaluate(`({background:getComputedStyle(document.querySelector('.codebuddy-menu-container')).backgroundColor,color:getComputedStyle(document.querySelector('.codebuddy-menu-container')).color})`)
  await fs.writeFile(path.join(output,'menu.png'),(await win.webContents.capturePage()).toPNG())
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'})
  await delay(200)
  const sidebarToggle=await evaluate(`(() => {const n=document.querySelector('#workbuddy-titlebar-left-slot button');if(!n)return null;const b=n.getBoundingClientRect();return{x:Math.round(b.x+b.width/2),y:Math.round(b.y+b.height/2)}})()`)
  if(!sidebarToggle)throw Error('Native sidebar toggle not found')
  for(const type of ['mouseDown','mouseUp'])win.webContents.sendInputEvent({type,...sidebarToggle,button:'left',clickCount:1})
  await delay(550)
  const collapsed=await evaluate(`({width:document.querySelector('[data-view-id=sidebar]')?.getBoundingClientRect().width??0,paint:parseFloat(document.documentElement.style.getPropertyValue('--closure-workbuddy-menu-width')),text:document.querySelector('[contenteditable=true]').textContent})`)
  assert.ok(collapsed.paint<100,'Collapsed sidebar paint must follow native compact layout')
  assert.equal(collapsed.text,draft)
  await fs.writeFile(path.join(output,'collapsed.png'),(await win.webContents.capturePage()).toPNG())
  for(const type of ['mouseDown','mouseUp'])win.webContents.sendInputEvent({type,...sidebarToggle,button:'left',clickCount:1})
  await delay(550)
  const settings=new BrowserWindow({width:900,height:720,show:false,focusable:false,skipTaskbar:true,
    webPreferences:{offscreen:true,backgroundThrottling:false,sandbox:true,contextIsolation:true}})
  await settings.loadURL('about:blank')
  settings.webContents.debugger.attach('1.3')
  await settings.webContents.debugger.sendCommand('Page.enable')
  await settings.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument',{source:await fs.readFile(path.join(__dirname,'workbuddy-theme-fixture.cjs'),'utf8')})
  await settings.loadFile(renderer,{query:{windowAppId:'settings',windowTheme:'light'}})
  let settingsPaint
  for(let n=0;n<100;n++){
    settingsPaint=await settings.webContents.executeJavaScript(`(() => {const chrome=document.querySelector('.settings-window-chrome');return {on:document.documentElement.getAttribute('data-closure-workbuddy-theme'),text:document.body.innerText.slice(0,1000),root:!!document.querySelector('.settings-window-root'),background:document.querySelector('.settings-window-root')?getComputedStyle(document.querySelector('.settings-window-root')).backgroundColor:null,chromeBackground:chrome?getComputedStyle(chrome).backgroundColor:null,chromeImage:chrome?getComputedStyle(chrome).backgroundImage:null,bodyImage:getComputedStyle(document.body).backgroundImage}})()`)
    if(settingsPaint.on==='on'&&settingsPaint.root&&settingsPaint.text.length>60)break
    await delay(100)
  }
  assert.equal(settingsPaint.on,'on');assert.equal(settingsPaint.root,true)
  assert.ok(settingsPaint.text.length>60,'Settings content must mount beyond its loading shell')
  assert.equal(settingsPaint.chromeBackground,'rgb(10, 11, 22)')
  assert.equal(settingsPaint.chromeImage,'none','Settings titlebar must not draw a grid decoration')
  assert.equal(settingsPaint.bodyImage,'none','Settings body must not expose the main-window top decoration')
  await fs.writeFile(path.join(output,'settings.png'),(await settings.webContents.capturePage()).toPNG())
  assert.equal(settings.isVisible(),false)
  settings.destroy()
  // The helper observes only this application's exact renderer file. It must
  // maintain the current document, release it on stop, and preserve drafts.
  await fs.writeFile(control,JSON.stringify({stop:`ws://127.0.0.1:${port}${browserPath}`}))
  await new Promise((resolve,reject)=>{helper.once('exit',code=>code===0?resolve():reject(Error(helperErrors)));setTimeout(()=>reject(Error('Theme helper did not stop')),7000).unref()})
  const released=await evaluate(`({styles:document.querySelectorAll('style[data-plugin=workbuddy-closure-codex-theme]').length,attribute:document.documentElement.hasAttribute('data-closure-workbuddy-theme'),variable:document.documentElement.style.getPropertyValue('--closure-workbuddy-menu-width'),controller:!!window.__closureWorkbuddyTheme,draft:document.querySelector('[contenteditable=true]').textContent,kind:document.body.getAttribute('data-vscode-theme-kind'),mode:document.documentElement.getAttribute('data-theme'),source:document.body.getAttribute('data-theme-source')})`)
  assert.equal(released.styles,0);assert.equal(released.attribute,false);assert.equal(released.variable,'');assert.equal(released.controller,false);assert.equal(released.draft,draft)
  assert.equal(released.kind,baseline.kind);assert.equal(released.mode,baseline.mode);assert.equal(released.source,baseline.source)
  // Check application mode changes are temporarily decorated and restored.
  const payload=await fs.readFile(path.join(plugin,'lib/renderer.js'),'utf8')
  await evaluate(payload)
  await evaluate(`document.documentElement.setAttribute('data-theme','light');document.body.setAttribute('data-vscode-theme-kind','vscode-light');document.body.setAttribute('data-theme-source','light');document.documentElement.classList.remove('dark');document.documentElement.classList.add('light');document.body.classList.remove('dark');document.body.classList.add('light')`)
  await waitFor(`document.documentElement.getAttribute('data-theme')==='dark'`)
  await evaluate(`window.__closureWorkbuddyTheme.dispose()`)
  assert.equal(await evaluate(`document.documentElement.getAttribute('data-theme')`),'light')
  assert.equal(await evaluate(`document.querySelector('[contenteditable=true]').textContent`),draft)
  assert.equal(win.isVisible(),false)
  assert.deepEqual(errors,[])
  const report={passed:true,version:require(path.join(plugin,'package.json')).version,themeRevision:require(path.join(plugin,'lib/build.json')).revision,hostVersion:require('../work/workbuddy-theme/host/package.json').version,
    scope:'Installed WorkBuddy renderer with synthetic offline host and data, hidden offscreen windows, actual CDP theme helper; native account and windows untouched',measurements,menuPaint,collapsed,settingsPaint,released,reloaded,draftRetained:true,rendererErrors:errors,blockedRemoteRequests:remoteRequests.length,hostDiagnosticCount:diagnostics.length}
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2))
  console.log(JSON.stringify({passed:true,sizes:measurements.length,draftRetained:true,restored:true,errors}))
  app.exit(0)
}).catch(async error=>{console.error(error);helper?.kill();app.exit(1)})
setTimeout(()=>{helper?.kill();app.exit(2)},55000).unref()
