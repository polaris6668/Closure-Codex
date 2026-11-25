const path = require('node:path')
const { spawn, execFile } = require('node:child_process')
const { mkdir, readFile, rename, unlink, writeFile } = require('node:fs/promises')
const { createInterface } = require('node:readline')
const { promisify } = require('node:util')

const run = promisify(execFile)
const loginLabel = 'local.closure-codex.companion.launch-at-login'
const escapeXML = (value) => value.replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[char])

function watchWindowHelper(args, report, onLost) {
  const executable = process.env.CLOSURE_WINDOW_HELPER || path.join(__dirname, 'mac-window-tracker')
  const child = spawn(executable, args, { stdio: ['ignore', 'pipe', 'ignore'] })
  const lines = createInterface({ input: child.stdout })
  let stopped = false
  lines.on('line', (line) => {
    if (stopped) return
    try {
      report(JSON.parse(line))
    } catch (error) {
      console.error('Closure window tracker:', error.message)
    }
  })
  child.on('error', (error) => console.error('Closure window tracker:', error.message))
  child.once('close', () => { if (!stopped) onLost() })
  return () => {
    stopped = true
    lines.close()
    child.kill()
  }
}

function followMacCodex(report, onLost) {
  return watchWindowHelper([], ({ visible, x, y, width, height }) => {
    report(visible && [x, y, width, height].every(Number.isFinite) ? { x, y, width, height } : null)
  }, onLost)
}

function watchMacPointerAvoidance(report) {
  return watchWindowHelper(['--pointer-avoidance'], ({ avoid }) => report(avoid === true), () => report(false))
}

async function macStartupSetting(app, enabled) {
  if (!app.isPackaged) {
    if (enabled) throw new Error('Launch the packaged app to register a login item.')
    return false
  }
  const folder = path.join(app.getPath('home'), 'Library', 'LaunchAgents')
  const file = path.join(folder, loginLabel + '.plist')
  const bundle = path.resolve(path.dirname(process.execPath), '../..')
  const domain = `gui/${process.getuid()}`
  const service = `${domain}/${loginLabel}`
  const launchctl = (args) => run('/bin/launchctl', args, { timeout: 7000 })
  const saved = await readFile(file, 'utf8').catch((error) => {
    if (error.code !== 'ENOENT') throw error
    return null
  })
  if (saved && !saved.includes(`<key>Label</key><string>${loginLabel}</string>`)) {
    throw new Error('A different launch agent already uses this filename.')
  }
  if (enabled === undefined) return Boolean(saved)
  const loaded = await launchctl(['print', service]).then(() => true, () => false)
  if (!enabled) {
    if (loaded) await launchctl(['bootout', service])
    if (saved) await unlink(file)
    return false
  }
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${loginLabel}</string>
<key>ProgramArguments</key><array><string>/usr/bin/open</string><string>-g</string><string>${escapeXML(bundle)}</string></array>
<key>RunAtLoad</key><true/>
</dict></plist>
`
  if (loaded && saved === plist) return true
  if (loaded) await launchctl(['bootout', service])
  await mkdir(folder, { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  await writeFile(temporary, plist, { mode: 0o600 })
  await rename(temporary, file)
  try {
    await launchctl(['bootstrap', domain, file])
  } catch (error) {
    if (saved) await writeFile(file, saved, { mode: 0o600 })
    else await unlink(file)
    if (loaded) await launchctl(['bootstrap', domain, file]).catch(() => {})
    throw error
  }
  return true
}

module.exports = { followMacCodex, macStartupSetting, watchMacPointerAvoidance }
