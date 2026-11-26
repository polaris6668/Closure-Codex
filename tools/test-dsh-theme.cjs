// Run against a separately extracted installed DSH runtime. Never uses ~/.dsh.
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '..')
const runtime = process.env.CLOSURE_DSH_RUNTIME || path.join(root, 'work/dsh-theme/host')
const entry = path.join(runtime, 'node_modules/@deepseek-ai/dsh/lib/bin.js')
const cli = process.env.CLOSURE_DSH_TEST_CLI
const electron = process.env.CLOSURE_ELECTRON_EXE || path.join(root, 'work/companion-runtime/electron/electron.exe')
if (!fs.existsSync(cli || entry) || !fs.existsSync(electron)) throw Error('Prepare an isolated DSH runtime and Electron first')
const fixture = process.env.CLOSURE_DSH_TEST_HOME || path.join(root, 'work/dsh-theme/test-home')
const profile = path.join(fixture, 'profiles/web')
fs.mkdirSync(path.join(profile, 'node_modules'), { recursive: true })
const packageFile = path.join(profile, 'package.json')
const manifest = fs.existsSync(packageFile) ? JSON.parse(fs.readFileSync(packageFile)) : {
  name: 'dsh-profile-web', private: true, dependencies: {}, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } },
}
const subject = process.env.CLOSURE_DSH_THEME_PLUGIN || path.join(root, 'plugins/dsh-closure-codex-theme')
const installed = path.join(profile, 'node_modules/dsh-closure-codex-theme')
if (!fs.existsSync(installed)) fs.symlinkSync(subject, installed, 'junction')
if (!manifest.dependencies['dsh-closure-codex-theme']) manifest.dependencies['dsh-closure-codex-theme'] = `file:${subject.replace(/\\/g, '/')}`
const probeId = 'closure-dsh-test-probe'
const probe = path.join(profile, 'node_modules', probeId)
fs.mkdirSync(probe, { recursive: true })
fs.writeFileSync(path.join(probe, 'package.json'), JSON.stringify({ name: probeId, version: '1.0.0', type: 'module',
  main: 'index.js', exports: { '.': './index.js', './client': './client.js', './package.json': './package.json' },
  dsh: { bundle: { patch: './cordis.patch.yml' }, client: { platform: 'web' } } }))
fs.writeFileSync(path.join(probe, 'index.js'), 'export function apply() {}\n')
fs.writeFileSync(path.join(probe, 'cordis.patch.yml'), `- insert:\n    - id: ${probeId}\n      name: ${probeId}\n`)
fs.writeFileSync(path.join(probe, 'client.js'), `window.__ModuleLoader__.load({id:'${probeId}',factory:require=>({inject:['theme','loader'],apply(ctx){
  window.__closureDshTest={
    mountCodeSamples(host){
      const {createElement,Fragment}=require('react'), {CodeBlock}=require('@deepseek-ai/dsh-client-ui-primitives')
      const root=require('react-dom/client').createRoot(host)
      const props={lang:'powershell',code:'Get-Date',copyLabel:'Copy',copiedLabel:'Copied'}
      require('react-dom').flushSync(()=>root.render(createElement(Fragment,null,
        createElement(CodeBlock,props),
        createElement(CodeBlock,{...props,toolbarLabels:{codeLabel:'Code',wrapLabel:'Wrap',unwrapLabel:'Unwrap'}}))))
      return ()=>root.unmount()
    },
    async enable(enabled){const entry=[...ctx.loader.entries()].find(e=>e.options.name==='dsh-closure-codex-theme');if(!entry)throw Error('missing subject entry');await entry.update({disabled:!enabled});await ctx.loader.await()},
    theme:ctx.theme
  }
}})})\n`)
manifest.dependencies[probeId] = `file:${probe.replace(/\\/g, '/')}`
for (const name of ['dsh-closure-codex-theme', probeId]) if (!manifest.dsh.profile.bundles.includes(name)) manifest.dsh.profile.bundles.push(name)
fs.writeFileSync(packageFile, JSON.stringify(manifest, null, 2))
const launcher = cli ? [] : [entry]
const server = spawn(cli || process.execPath, [...launcher, 'web', '--no-open', '--host', '127.0.0.1', '--port', '0'], {
  cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, DSH_HOME: fixture, DEEPSEEK_API_KEY: 'sk-local-theme-test-never-used-for-completion' },
})
let started = false, stdout = '', stderr = '', settled = false, activeTest
const timer = setTimeout(() => finish(2, 'DSH test timed out'), 65000)
function finish(code, message) {
  if (settled) return
  settled = true
  clearTimeout(timer)
  activeTest?.kill()
  server.kill()
  if (message) console.error(message)
  process.exitCode = code
}
server.on('error', error => finish(1, error.message))
server.stderr.on('data', data => { stderr += data; })
server.stdout.on('data', data => {
  stdout += data
  const match = stdout.match(/dsh web: (http:\/\/127\.0\.0\.1:[^\s]+)/)
  if (!match || started) return
  started = true
  console.log('Isolated DSH host ready')
  const baselineOnly = process.env.CLOSURE_DSH_BASELINE_LAYOUT === '1'
  function runTest(baseline) {
    if (settled) return
    const test = activeTest = spawn(electron, [path.join(root, 'tests/dsh-theme-integration.cjs')], {
      cwd: root, stdio: 'inherit', windowsHide: true,
      env: { ...process.env, CLOSURE_DSH_TEST_URL: match[1], CLOSURE_DSH_BASELINE_LAYOUT: baseline ? '1' : '0' },
    })
    test.on('error', error => finish(1, error.message))
    test.on('exit', code => {
      if (activeTest === test) activeTest = undefined
      if (code === 0 && baseline && !baselineOnly) runTest(false)
      else finish(code ?? 1)
    })
  }
  runTest(true)
})
server.on('exit', code => { if (!started) finish(code || 1, stderr.slice(-2000)) })
