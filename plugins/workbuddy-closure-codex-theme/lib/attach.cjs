const fs=require('node:fs/promises')
const path=require('node:path')
const {parseArgs}=require('node:util')
const {fileURLToPath}=require('node:url')
const {connect,evaluate}=require('./cdp.cjs')
const {values}=parseArgs({options:{port:{type:'string'},browser:{type:'string'},renderer:{type:'string'},state:{type:'string'},control:{type:'string'}}})
const port=Number(values.port)
if(!Number.isInteger(port)||port<1024||port>65535||!values.renderer||!values.state||!values.control)throw Error('Invalid theme helper arguments')
const sessions=new Map()
const sameFile=url=>{try{return path.resolve(fileURLToPath(new URL(url))).toLowerCase()===path.resolve(values.renderer).toLowerCase()}catch{return false}}
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))
async function writeState(value){const file=values.state+'.tmp';await fs.writeFile(file,JSON.stringify(value,null,2));await fs.rename(file,values.state)}
async function release(entry){
  if(!entry.client.closed){
    if(entry.scriptId)await entry.client.send('Page.removeScriptToEvaluateOnNewDocument',{identifier:entry.scriptId}).catch(()=>{})
    await evaluate(entry.client,'window.__closureWorkbuddyTheme?.dispose()').catch(()=>{})
  }
  entry.client.close()
}
let anchor
async function main(){
  const payload=await fs.readFile(path.join(__dirname,'renderer.js'),'utf8')
  anchor=await connect(values.browser,port)
  while(!anchor.closed){
    const control=await fs.readFile(values.control,'utf8').then(JSON.parse).catch(()=>null)
    if(control?.stop===values.browser)break
    try{
      const response=await fetch(`http://127.0.0.1:${port}/json/list`,{signal:AbortSignal.timeout(2500)})
      if(!response.ok)throw Error('WorkBuddy debug target list unavailable')
      const targets=(await response.json()).filter(t=>t.type==='page'&&sameFile(t.url))
      const current=new Set(targets.map(t=>t.id))
      for(const [id,entry]of sessions)if(!current.has(id)||entry.client.closed){await release(entry);sessions.delete(id)}
      const statuses=[]
      for(const target of targets){
        let entry=sessions.get(target.id)
        try{
          if(!entry){
            entry={client:await connect(target.webSocketDebuggerUrl,port)}
            sessions.set(target.id,entry)
            await entry.client.send('Page.enable')
            const script=await entry.client.send('Page.addScriptToEvaluateOnNewDocument',{source:payload})
            entry.scriptId=script.identifier
          }
          statuses.push({id:target.id,...await evaluate(entry.client,payload)})
        }catch(error){if(entry)await release(entry);sessions.delete(target.id);statuses.push({id:target.id,error:error.message})}
      }
      await writeState({running:true,pid:process.pid,port,targets:statuses})
    }catch(error){await writeState({running:true,pid:process.pid,port,error:error.message})}
    await delay(750)
  }
}
main().catch(error=>{console.error(error);process.exitCode=1}).finally(async()=>{
  for(const entry of sessions.values())await release(entry)
  anchor?.close()
  await writeState({running:false,pid:process.pid,port}).catch(()=>{})
})
