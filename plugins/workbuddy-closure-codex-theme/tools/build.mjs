import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {TOKENS} from '../src/palette.mjs'
const root=fileURLToPath(new URL('../',import.meta.url))
const css=(await readFile(path.join(root,'src/theme.css'),'utf8')).replace('__CLOSURE_WORKBUDDY_TOKENS__',Object.entries(TOKENS).map(([name,value])=>`${name}:${value} !important;`).join('\n  '))
const controller=await readFile(path.join(root,'src/controller.mjs'),'utf8')
const revision=createHash('sha256').update(css).update(controller).digest('hex').slice(0,16)
const script=`(() => {${controller.replace('export function','function')};function install(){return mountTheme({document,css:${JSON.stringify(css)},revision:${JSON.stringify(revision)}}).snapshot()};if(!document.documentElement||!document.body){document.addEventListener('DOMContentLoaded',install,{once:true});return {waitingForDocument:true}};return install()})()`
await mkdir(path.join(root,'lib'),{recursive:true})
await writeFile(path.join(root,'lib/theme.css'),css)
await writeFile(path.join(root,'lib/renderer.js'),script)
await writeFile(path.join(root,'lib/build.json'),JSON.stringify({revision,tokens:Object.keys(TOKENS).length},null,2))
console.log(`Built WorkBuddy theme: ${Object.keys(TOKENS).length} tokens, revision ${revision}`)
