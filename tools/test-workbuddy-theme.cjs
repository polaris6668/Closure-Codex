// Extract installed renderer assets for hidden tests. No user profile is read.
const fs=require('node:fs')
const path=require('node:path')
const {spawn}=require('node:child_process')
const root=path.resolve(__dirname,'..')
const archive=process.env.CLOSURE_WORKBUDDY_ASAR||path.join(process.env.LOCALAPPDATA,'Programs/WorkBuddy/resources/app.asar')
const destination=path.join(root,'work/workbuddy-theme/host')
const electron=process.env.CLOSURE_ELECTRON_EXE||path.join(root,'work/companion-runtime/electron/electron.exe')
const fd=fs.openSync(archive,'r')
try{
  const prefix=Buffer.alloc(16);fs.readSync(fd,prefix,0,16,0)
  const buffer=Buffer.alloc(prefix.readUInt32LE(12));fs.readSync(fd,buffer,0,buffer.length,16)
  const header=JSON.parse(buffer.toString('utf8')),dataOffset=8+prefix.readUInt32LE(4)
  function extract(node,base=''){
    for(const [name,item]of Object.entries(node.files||{})){
      const relative=base+name
      if(item.files){if(relative==='renderer'||relative.startsWith('renderer/'))extract(item,relative+'/');continue}
      if(!relative.startsWith('renderer/')&&relative!=='package.json')continue
      if(relative.split(/[\\/]/).includes('..'))throw Error('Unexpected archive path')
      const output=path.join(destination,relative)
      fs.mkdirSync(path.dirname(output),{recursive:true})
      let bytes
      if(item.unpacked)bytes=fs.readFileSync(path.join(archive+'.unpacked',relative))
      else{bytes=Buffer.alloc(item.size);fs.readSync(fd,bytes,0,bytes.length,dataOffset+Number(item.offset))}
      fs.writeFileSync(output,bytes)
    }
  }
  extract(header)
}finally{fs.closeSync(fd)}
const test=spawn(electron,[path.join(root,'tests/workbuddy-theme-integration.cjs')],{cwd:root,windowsHide:true,stdio:'inherit',env:{...process.env,CLOSURE_WB_RENDERER:path.join(destination,'renderer/index.html')}})
test.on('error',error=>{console.error(error);process.exitCode=1})
test.on('exit',code=>{process.exitCode=code??1})
