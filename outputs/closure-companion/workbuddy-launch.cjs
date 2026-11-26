const fs = require('node:fs/promises')
const path = require('node:path')
const net = require('node:net')
const { spawn } = require('node:child_process')
const { discover, powershellJson, verifyOwner } = require('./workbuddy.cjs')

async function launch() {
  const executable = process.env.CLOSURE_WORKBUDDY_EXE || path.join(process.env.LOCALAPPDATA, 'Programs/WorkBuddy/WorkBuddy.exe')
  await fs.access(executable)
  if (await discover({ executable })) return { ok: true, message: 'WorkBuddy 联动连接已就绪。' }
  const running = await powershellJson(`@(Get-CimInstance Win32_Process -Filter "Name='WorkBuddy.exe'" | Where-Object { $_.ExecutablePath -eq $env:CLOSURE_WB_EXE }).Count`, { CLOSURE_WB_EXE: executable })
  if (running > 0) throw Error('请先从托盘退出普通 WorkBuddy，再使用本联动入口启动。')
  let port
  for (let candidate = 19388; candidate < 19408; candidate++) {
    const free = await new Promise(resolve => {
      const server = net.createServer()
      server.on('error', () => resolve(false))
      server.listen(candidate, '127.0.0.1', () => server.close(() => resolve(true)))
    })
    if (free) { port = candidate; break }
  }
  if (!port) throw Error('WorkBuddy 联动端口暂时不可用，请稍后重试。')
  const env = { ...process.env, WORKBUDDY_REMOTE_DEBUGGING_PORT: String(port) }
  delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS
  const child = spawn(executable, ['--remote-debugging-address=127.0.0.1'], { detached: true, windowsHide: true, stdio: 'ignore', env })
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject) })
  child.unref()
  for (let i = 0; i < 50; i++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(800) }).then(r => r.json())
      if (!response.webSocketDebuggerUrl) throw Error('Not ready')
      await verifyOwner(port, executable)
      const root = path.join(process.env.LOCALAPPDATA, 'ClosureCompanion')
      await fs.mkdir(root, { recursive: true })
      await fs.writeFile(path.join(root, 'workbuddy-session.json'), JSON.stringify({ executable, port }), { mode: 0o600 })
      return { ok: true, message: 'WorkBuddy 已从联动入口启动。' }
    } catch { await new Promise(resolve => setTimeout(resolve, 500)) }
  }
  throw Error('WorkBuddy 联动连接尚未就绪，请稍后重新打开本入口。')
}
if (require.main === module) launch().then(value => console.log(JSON.stringify(value))).catch(error => { console.error(error.message); process.exitCode = 1 })
module.exports = { launch }
