const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '..')
const output = path.join(root, 'work/companion-integration')
fs.mkdirSync(output, { recursive: true })
const run = fs.mkdtempSync(path.join(output, 'ui-'))
const electron = path.join(root, 'work/companion-runtime/electron/electron.exe')
const env = { ...process.env, CLOSURE_STATE_DIR: path.join(run, 'profile'), CLOSURE_RUNTIME_SMOKE_PNG: path.join(run, 'menu.png') }
delete env.ELECTRON_RUN_AS_NODE
const args = process.argv.includes('--assets') ? [path.join(root, 'tests/assets-integration.cjs')]
  : process.argv.includes('--workbuddy') ? [path.join(root, 'tests/workbuddy-companion-integration.cjs')]
  : [path.join(root, 'outputs/closure-companion'), '--smoke', '--mute-audio', ...(process.argv.includes('--canvas') ? ['--canvas'] : [])]
const child = spawn(electron, args, { cwd: root, windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'] })
let logs = ''
for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { logs += data })
const timer = setTimeout(() => { console.error('Hidden UI test timed out'); child.kill(); process.exitCode = 2 }, 45000)
child.on('exit', code => {
  clearTimeout(timer)
  fs.writeFileSync(path.join(run, 'test.log'), logs)
  console.log(logs.slice(-5000))
  console.log('Background UI test exit:', code, 'Artifacts:', run)
  process.exitCode = code || process.exitCode || 0
})
