const fs=require('node:fs/promises')
const path=require('node:path')
const net=require('node:net')
const {spawn}=require('node:child_process')
const {parseArgs}=require('node:util')
const {powershellJson}=require('./windows.cjs')
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))
const readJson=file=>fs.readFile(file,'utf8').then(JSON.parse).catch(()=>null)
async function writeJson(file,value){await fs.writeFile(file+'.tmp',JSON.stringify(value,null,2));await fs.rename(file+'.tmp',file)}
const equalPath=(a,b)=>typeof a==='string'&&typeof b==='string'&&path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase()
const defaultRoot=()=>path.join(process.env.LOCALAPPDATA,'ClosureWorkBuddyTheme')
async function findInstall(){
  const candidates=[process.env.CLOSURE_WORKBUDDY_EXE,path.join(process.env.LOCALAPPDATA,'Programs/WorkBuddy/WorkBuddy.exe')].filter(Boolean)
  for(const executable of candidates){
    if(!await fs.stat(executable).then(s=>s.isFile()).catch(()=>false))continue
    const renderer=path.join(path.dirname(executable),'resources/app.asar/renderer/index.html')
    return {executable,renderer}
  }
  throw Error('未找到 WorkBuddy；请先安装桌面版，或设置 CLOSURE_WORKBUDDY_EXE。')
}
async function getProcesses(pkg){
  const result=await powershellJson(`
    @(Get-CimInstance Win32_Process -Filter "Name='WorkBuddy.exe'" | Where-Object {
      $_.ExecutablePath -eq $env:CLOSURE_WB_EXE -and $_.CommandLine -notmatch '\\s--type=' -and
      $_.CommandLine -notmatch '(?:app\\.asar|daemon|worker|utility)'
    } | ForEach-Object {
      $p=Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue
      $child=Get-CimInstance Win32_Process -Filter ('ParentProcessId=' + $_.ProcessId) | Where-Object {$_.CommandLine -match '--user-data-dir='} | Select-Object -First 1
      $profileMatch=[regex]::Match([string]$child.CommandLine,'(?:"--user-data-dir=([^"]+)"|--user-data-dir="([^"]+)"|--user-data-dir=([^\s]+))')
      $profile=$null
      if($profileMatch.Success){$profile=@($profileMatch.Groups[1].Value,$profileMatch.Groups[2].Value,$profileMatch.Groups[3].Value) | Where-Object {$_} | Select-Object -First 1}
      [pscustomobject]@{pid=$_.ProcessId;created=$_.CreationDate.ToString('o');hasWindow=($p.MainWindowHandle -ne 0);userData=$profile}
    })
  `,{CLOSURE_WB_EXE:pkg.executable})
  return [result].flat().filter(Boolean)
}
function selectTarget(processes){
  const visible=processes.filter(p=>p.hasWindow)
  if(visible.length===1)return visible[0]
  if(visible.length>1||processes.length>1)throw Error('检测到多个 WorkBuddy 实例，请保留要使用主题的实例后重试。')
  return processes[0]??null
}
async function verifyOwner(port,pkg){
  const result=await powershellJson(`
    @(Get-NetTCPConnection -State Listen -LocalPort $env:CLOSURE_WB_PORT -ErrorAction Stop | ForEach-Object {
      $p=Get-CimInstance Win32_Process -Filter ('ProcessId=' + $_.OwningProcess)
      [pscustomobject]@{pid=$_.OwningProcess;address=$_.LocalAddress;executable=$p.ExecutablePath;created=$p.CreationDate.ToString('o')}
    })
  `,{CLOSURE_WB_PORT:String(port)})
  const owners=[result].flat().filter(Boolean)
  if(!owners.length||owners.some(p=>!['127.0.0.1','::1'].includes(p.address)||!equalPath(p.executable,pkg.executable)))throw Error('主题端口不属于本机 WorkBuddy。')
  return owners
}
async function choosePort(){
  for(let port=19368;port<19388;port++){
    const free=await new Promise(resolve=>{const server=net.createServer();server.on('error',()=>resolve(false));server.listen(port,'127.0.0.1',()=>server.close(()=>resolve(true)))})
    if(free)return port
  }
  throw Error('主题启动端口暂时不可用。')
}
async function closeTarget(pkg,target){
  // Ask the owning application to quit cleanly. Never force-stop a user task.
  await powershellJson(`
    $p=Get-CimInstance Win32_Process -Filter ('ProcessId=' + $env:CLOSURE_WB_PID)
    if(!$p){return $true}
    if($p.ExecutablePath -ne $env:CLOSURE_WB_EXE -or $p.CreationDate.ToString('o') -ne $env:CLOSURE_WB_CREATED){throw 'WorkBuddy process identity changed'}
    $w=Get-Process -Id $p.ProcessId
    [void]$w.CloseMainWindow()
    $true
  `,{CLOSURE_WB_PID:String(target.pid),CLOSURE_WB_CREATED:target.created,CLOSURE_WB_EXE:pkg.executable})
  for(let n=0;n<40;n++){
    const alive=await powershellJson(`$p=Get-CimInstance Win32_Process -Filter ('ProcessId=' + $env:CLOSURE_WB_PID); [bool]($p -and $p.CreationDate.ToString('o') -eq $env:CLOSURE_WB_CREATED)`,{CLOSURE_WB_PID:String(target.pid),CLOSURE_WB_CREATED:target.created})
    if(!alive)return
    await delay(250)
  }
  throw Error('WorkBuddy 仍在运行。请先从托盘退出 WorkBuddy，再打开主题入口；主题未强制结束任何进程。')
}
async function startWorkBuddy(pkg,port){
  const env={...process.env}
  delete env.ELECTRON_RUN_AS_NODE
  delete env.NODE_OPTIONS
  delete env.WORKBUDDY_REMOTE_DEBUGGING_PORT
  if(port)env.WORKBUDDY_REMOTE_DEBUGGING_PORT=String(port)
  const args=port?['--remote-debugging-address=127.0.0.1']:[]
  const child=spawn(pkg.executable,args,{detached:true,windowsHide:true,stdio:'ignore',env})
  await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject)})
  child.unref()
}
async function waitBrowser(pkg,port){
  for(let n=0;n<50;n++){
    try{
      const response=await fetch(`http://127.0.0.1:${port}/json/version`,{signal:AbortSignal.timeout(800)})
      const value=await response.json()
      if(!value.webSocketDebuggerUrl)throw Error('WorkBuddy 未开放主题连接。')
      await verifyOwner(port,pkg)
      return value.webSocketDebuggerUrl
    }catch(error){if(n===49)throw error;await delay(400)}
  }
}
async function stopHelper(record){
  if(!record?.browser||!record.control)return
  await writeJson(record.control,{stop:record.browser})
  for(let n=0;n<30;n++){
    const state=await readJson(record.state)
    if(state?.pid===record.helperPid&&!state.running)return
    await delay(150)
  }
  throw Error('主题助手尚未完成恢复，请稍候重试。')
}
async function run(options,services={}){
  const api={findInstall,getProcesses,choosePort,verifyOwner,closeTarget,startWorkBuddy,waitBrowser,stopHelper,...services}
  const root=path.resolve(options.root||defaultRoot()),sessionFile=path.join(root,'session.json')
  await fs.mkdir(root,{recursive:true})
  const previous=await readJson(sessionFile)
  if(options.mode==='disable'){
    if(!previous?.running)return {ok:true,message:'主题已关闭。'}
    await api.stopHelper(previous)
    await writeJson(sessionFile,{...previous,running:false})
    return {ok:true,message:'主题已撤销，窗口保留；关闭并重新打开普通 WorkBuddy 后，主题连接端口也会随之关闭。'}
  }
  const pkg=await api.findInstall()
  let processes=await api.getProcesses(pkg),target=selectTarget(processes)
  if(options.mode==='inspect')return {ok:true,installed:pkg,target,theme:previous?.running===true}
  await fs.readFile(path.join(__dirname,'renderer.js'),'utf8')
  if(typeof WebSocket!=='function')throw Error('主题需要 Node.js 22 或更新版本。')
  let port,browser
  if(previous?.browser&&equalPath(previous.executable,pkg.executable)){
    try{await api.verifyOwner(previous.port,pkg);browser=await api.waitBrowser(pkg,previous.port);port=previous.port;if(previous.running&&browser===previous.browser)await api.stopHelper(previous)}catch{browser=null}
  }
  if(!browser){
    const configDir=process.env.WORKBUDDY_CONFIG_DIR||process.env.CODEBUDDY_CONFIG_DIR||path.join(process.env.USERPROFILE,'.workbuddy')
    const expected=process.env.WORKBUDDY_USER_DATA_DIR||path.join(configDir,'app')
    if(target?.userData&&!equalPath(target.userData,expected))throw Error('当前 WorkBuddy 使用独立配置目录。请在相同的 WORKBUDDY_CONFIG_DIR / WORKBUDDY_USER_DATA_DIR 启动环境中运行主题入口。')
    port=await api.choosePort()
    if(target){await api.closeTarget(pkg,target);target=null}
    await api.startWorkBuddy(pkg,port)
    browser=await api.waitBrowser(pkg,port)
  }
  const state=path.join(root,'helper.json'),control=path.join(root,'control.json')
  await fs.unlink(control).catch(error=>{if(error.code!=='ENOENT')throw error})
  const log=await fs.open(path.join(root,'helper.log'),'a')
  let helper
  try{
    helper=spawn(process.execPath,[path.join(__dirname,'attach.cjs'),'--port',String(port),'--browser',browser,'--renderer',pkg.renderer,'--state',state,'--control',control],{detached:true,windowsHide:true,stdio:['ignore',log.fd,log.fd],env:process.env})
    await new Promise((resolve,reject)=>{helper.once('spawn',resolve);helper.once('error',reject)})
    helper.unref()
  }finally{await log.close()}
  const record={running:true,executable:pkg.executable,port,browser,state,control,helperPid:helper.pid}
  await writeJson(sessionFile,record)
  for(let n=0;n<60;n++){
    const value=await readJson(state)
    if(value?.pid===helper.pid&&value.targets?.some(t=>t.installed&&t.menu))return {ok:true,message:'WorkBuddy 深色主题已启用。以后使用本主题入口启动。'}
    if(value?.pid===helper.pid&&!value.running)throw Error('主题助手已退出，请查看 helper.log。')
    await delay(250)
  }
  return {ok:true,message:'主题助手已连接；WorkBuddy 主界面加载后会自动应用。'}
}
async function main(){
  const {values}=parseArgs({options:{mode:{type:'string',default:'enable'},root:{type:'string'}}})
  if(!['enable','disable','inspect'].includes(values.mode))throw Error('Invalid mode')
  const root=path.resolve(values.root||defaultRoot())
  await fs.mkdir(root,{recursive:true})
  let lock
  const lockFile=path.join(root,'operation.lock')
  try{
    if(values.mode!=='inspect'){
      try{lock=await fs.open(lockFile,'wx')}catch(error){
        if(error.code!=='EEXIST')throw error
        const owner=Number(await fs.readFile(lockFile,'utf8'))
        if(!Number.isInteger(owner)||owner<=0)throw Error('主题操作锁无效。')
        try{process.kill(owner,0);throw Error('主题正在处理中，请稍候。')}catch(error){if(error.code!=='ESRCH')throw error}
        await fs.unlink(lockFile);lock=await fs.open(lockFile,'wx')
      }
      await lock.writeFile(String(process.pid))
    }
    console.log(JSON.stringify(await run(values),null,2))
  }finally{if(lock){await lock.close();await fs.unlink(lockFile).catch(()=>{})}}
}
if(require.main===module)main().catch(error=>{console.error(error.stack||error);process.exitCode=1})
module.exports={run,selectTarget,findInstall,getProcesses,equalPath}
