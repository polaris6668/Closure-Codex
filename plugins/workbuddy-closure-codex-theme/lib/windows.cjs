const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const run = promisify(execFile)

async function powershellJson(source, env = {}) {
  // Windows PowerShell 5.1 emits no JSON for a null/empty pipeline result.
  const script = `$ErrorActionPreference='Stop'; $result = & { ${source} }; if ($null -eq $result) { $json = 'null' } else { $json = ConvertTo-Json -InputObject $result -Depth 6 -Compress }; [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))`
  const { stdout } = await run('powershell.exe', ['-NoLogo','-NoProfile','-NonInteractive','-Command',script],
    { windowsHide:true, timeout:20000, env:{...process.env,...env} })
  return JSON.parse(Buffer.from(stdout.trim(),'base64').toString('utf8'))
}

module.exports = { powershellJson }
