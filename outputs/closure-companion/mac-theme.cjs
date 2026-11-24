const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { execFile, spawn } = require('node:child_process')
const { createInterface } = require('node:readline')
const { promisify } = require('node:util')
const { connect, evaluate } = require('../closure-decoration/cdp.cjs')
const { buildPayload } = require('../closure-decoration/renderer-payload.cjs')

const run = promisify(execFile)
const paletteFile = path.join(__dirname, '../closure-theme/closure-dark.txt')
const codexPage = /^app:\/\/-\/index\.html(?:[?#]|$)/

async function officialExecutables() {
  const executables = []
  for (const root of ['/Applications', path.join(os.homedir(), 'Applications')]) {
    for (const name of ['ChatGPT', 'Codex']) {
      const contents = path.join(root, `${name}.app`, 'Contents')
      const plist = path.join(contents, 'Info.plist')
      const find = (key) => run('/usr/bin/plutil', ['-extract', key, 'raw', plist], { timeout: 3000 }).then(({ stdout }) => stdout.trim(), () => '')
      if (await find('CFBundleIdentifier') !== 'com.openai.codex') continue
      const binary = await find('CFBundleExecutable')
      if (/^[\w.-]+$/.test(binary)) executables.push(path.join(contents, 'MacOS', binary))
    }
  }
  return executables
}

async function launchCodex() {
  const executables = await officialExecutables()
  if (!executables.length) throw new Error('找不到本机 Codex 应用。')
  const { stdout } = await run('/bin/ps', ['-axo', 'comm='], { timeout: 4000 })
  const running = stdout.split('\n').some((line) => executables.includes(line.trim()))
  if (running) throw new Error('请先用 ⌘Q 退出 Codex，再点「启动 CRT 版 Codex」。')
  const child = spawn(executables[0], ['--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0'], {
    detached: true, stdio: ['ignore', 'ignore', 'pipe'],
  })
  child.unref()
  const lines = createInterface({ input: child.stderr })
  const endpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error('Codex 未提供本机调试连接。')), 12000)
    function finish(error, result) {
      clearTimeout(timer)
      child.removeListener('exit', exited)
      lines.close()
      child.stderr.resume()
      child.stderr.unref?.()
      if (error) reject(error)
      else resolve(result)
    }
    const exited = () => finish(new Error('Codex 启动后退出了。'))
    child.once('exit', exited)
    child.once('error', () => finish(new Error('Codex 启动失败。')))
    lines.on('line', (line) => {
      const match = /DevTools listening on (ws:\/\/127\.0\.0\.1:(\d+)\/devtools\/browser\/[\w-]+)/.exec(line)
      if (match) finish(null, { browser: match[1], port: Number(match[2]), pid: child.pid })
    })
  })
  const sockets = await run('/usr/sbin/lsof', ['-nP', '-a', '-p', String(endpoint.pid), '-iTCP:' + endpoint.port, '-sTCP:LISTEN', '-Fn'], { timeout: 4000 })
  const listeners = sockets.stdout.split('\n').filter((line) => line.startsWith('n'))
  if (!listeners.length || listeners.some((line) => line !== `n127.0.0.1:${endpoint.port}`)) throw new Error('无法验证 Codex 的本机调试连接。')
  return endpoint
}

async function connectTheme({ browser, port }) {
  const payload = await buildPayload()
  const anchor = await connect(browser, port)
  const pages = new Map()

  async function release({ client, script }) {
    if (!client.closed && script) await client.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: script }).catch(() => {})
    if (!client.closed) await evaluate(client, 'window.__closurePageDecoration?.dispose()').catch(() => {})
    client.close()
  }

  return {
    get closed() { return anchor.closed },
    async update() {
      if (anchor.closed) throw new Error('Codex 的调试连接已关闭。')
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(3000), redirect: 'error' })
      if (anchor.closed || !response.ok) throw new Error('无法读取 Codex 页面。')
      const targets = (await response.json()).filter((page) => page.type === 'page' && codexPage.test(page.url))
      const current = new Set(targets.map(({ id }) => id))
      let ready = false
      for (const [id, page] of pages) {
        if (current.has(id) && !page.client.closed) continue
        pages.delete(id)
        await release(page)
      }
      for (const target of targets) {
        let page = pages.get(target.id)
        try {
          if (!page) {
            const client = await connect(target.webSocketDebuggerUrl, port)
            page = { client }
            pages.set(target.id, page)
            const { identifier } = await client.send('Page.addScriptToEvaluateOnNewDocument', { source: payload })
            page.script = identifier
          }
          const result = await evaluate(page.client, payload)
          ready ||= Boolean(result?.shellReady)
        } catch {
          if (page) await release(page)
          pages.delete(target.id)
        }
      }
      return ready
    },
    async stop() {
      await Promise.all([...pages.values()].map(release))
      pages.clear()
      anchor.close()
    },
  }
}

function createMacTheme(clipboard) {
  let endpoint, connection, timer, current, busy = false
  let ready = false

  async function refresh() {
    clearTimeout(timer)
    try {
      ready = await connection.update()
    } catch {
      ready = false
    } finally {
      if (!connection.closed) timer = setTimeout(() => { current = refresh() }, 1500)
    }
  }

  function status() {
    const enabled = Boolean(connection && !connection.closed)
    return { enabled, message: enabled ? (ready ? 'CRT 页面装饰已启用。' : '等待 Codex 主界面，进入后自动加载。') : '' }
  }

  async function stop() {
    clearTimeout(timer)
    await current
    clearTimeout(timer)
    const previous = connection
    connection = null
    ready = false
    await previous?.stop()
  }

  async function action(name) {
    if (name === 'status') return status()
    if (name === 'copy') {
      clipboard.writeText((await fs.readFile(paletteFile, 'utf8')).trim())
      return { ...status(), message: '配色已复制。请在 Codex 设置 → 外观 → 深色主题中点「导入」。' }
    }
    if (busy) return { ...status(), message: '主题操作正在进行。' }
    busy = true
    try {
      if (name === 'disable') {
        await stop()
        return { ...status(), message: 'CRT 已关闭。退出 Codex 后，本机调试连接也会结束。' }
      }
      if (name !== 'enable') throw new Error('未知主题操作。')
      if (!status().enabled) {
        await stop()
        if (endpoint) connection = await connectTheme(endpoint).catch(() => null)
        if (!connection) {
          endpoint = await launchCodex()
          connection = await connectTheme(endpoint)
        }
        current = refresh()
        await current
      }
      return status()
    } catch (error) {
      return { ...status(), message: error.message }
    } finally {
      busy = false
    }
  }

  return { action, stop, isRunning: () => Boolean(connection || busy) }
}

module.exports = { createMacTheme, connectTheme }
