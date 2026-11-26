const fs = require('node:fs/promises')
const path = require('node:path')
const { spawn } = require('node:child_process')
const assert = require('node:assert/strict')
const root = path.resolve(__dirname, '..')
const home = process.env.CLOSURE_DSH_COMPANION_TEST_HOME || path.join(root, 'work/companion-integration/dsh-home')
const profile = path.join(home, 'profiles/web')
const directory = path.join(home, 'bridge-state')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function main() {
  await fs.mkdir(path.join(profile, 'node_modules'), { recursive: true })
  await fs.mkdir(directory, { recursive: true })
  const name = 'dsh-closure-companion-bridge'
  const subject = process.env.CLOSURE_DSH_COMPANION_PLUGIN || path.join(root, 'plugins', name)
  await fs.symlink(subject, path.join(profile, 'node_modules', name), 'junction').catch(e => { if (e.code !== 'EEXIST') throw e })
  const probe = path.join(profile, 'node_modules/closure-companion-probe')
  await fs.mkdir(probe, { recursive: true })
  await fs.writeFile(path.join(probe, 'package.json'), JSON.stringify({ name: 'closure-companion-probe', version: '1.0.0', type: 'module', main: 'index.js', dsh: { bundle: { patch: './cordis.patch.yml' } } }))
  await fs.writeFile(path.join(probe, 'cordis.patch.yml'), '- insert:\n    - id: closure-companion-probe\n      name: closure-companion-probe\n')
  await fs.writeFile(path.join(probe, 'index.js'), `
    export const inject=['sessions','agents','deepseekAccount'];
    export function apply(ctx){const timer=setTimeout(()=>{
      const main=ctx.sessions.create('closure-native-test-main');
      const child=ctx.sessions.create('closure-native-test-child',{meta:{origin:'subagent'}});
      for(const s of [main,child]){s.append('turn/start',{turn:1});s.append('turn/end',{turn:1,reason:{kind:'completed'}})}
    },2500);ctx.effect(()=>()=>clearTimeout(timer))}
  `)
  await fs.writeFile(path.join(profile, 'package.json'), JSON.stringify({ name: 'closure-native-test', private: true,
    dependencies: { [name]: 'file:' + subject.replace(/\\/g, '/'), 'closure-companion-probe': 'file:' + probe.replace(/\\/g, '/') },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', name, 'closure-companion-probe'] } } }))
  await fs.writeFile(path.join(profile, 'cordis.patch.yml'), `- id: ${name}\n  config:\n    directory: ${JSON.stringify(directory)}\n`)
  const target = path.join(directory, 'dsh.json')
  await fs.unlink(target).catch(() => {})
  const lease = setInterval(() => fs.writeFile(path.join(directory, 'dsh-request.json'), JSON.stringify({ enabled: true, updatedAt: Date.now() })).catch(() => {}), 1000)
  await fs.writeFile(path.join(directory, 'dsh-request.json'), JSON.stringify({ enabled: true, updatedAt: Date.now() }))
  const cli = process.env.CLOSURE_DSH_COMPANION_TEST_CLI
  const launcher = cli ? [] : [path.join(root, 'work/dsh-theme/host/node_modules/@deepseek-ai/dsh/lib/bin.js')]
  const server = spawn(cli || process.execPath, [...launcher, 'web', '--no-open', '--host', '127.0.0.1', '--port', '0'], {
    cwd: root, windowsHide: true, env: { ...process.env, DSH_HOME: home }, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let logs = '', exited = false
  for (const stream of [server.stdout, server.stderr]) stream.on('data', value => { logs += value.toString(); if (logs.length > 16000) logs = logs.slice(-16000) })
  server.on('exit', () => { exited = true })
  try {
    let value
    for (let i = 0; i < 45; i++) {
      await sleep(500)
      value = await fs.readFile(target, 'utf8').then(JSON.parse).catch(() => null)
      if (value?.state?.turnEnd?.seq === 1) break
      if (exited) throw Error('Isolated DSH exited: ' + logs.slice(-2000))
    }
    assert.equal(value?.state?.turnStartSeq, 1, logs.slice(-2000))
    assert.equal(value.state.turnEnd.seq, 1)
    assert.equal(value.state.turnEnd.kind, 'completed')
    assert.equal(value.balance.status, 'signed-out', 'The real isolated account service must return signed out')
    assert.doesNotMatch(logs, /Cannot resolve|plugin.*failed|unknown service/i)
    await fs.writeFile(path.join(home, 'verification.json'), JSON.stringify({ passed: true, nativeEvents: true, excludesSubagents: true, officialSignedOut: true }, null, 2))
    console.log('Native DSH: plugin mount, session events, subagent filtering and official account service passed.')
  } finally { clearInterval(lease); server.kill() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
