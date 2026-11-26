const {test}=require('node:test')
const assert=require('node:assert/strict')
const {randomUUID}=require('node:crypto')
const {powershellJson}=require('../outputs/closure-decoration/official-runtime.cjs')
const {getProcesses}=require('../outputs/closure-decoration/theme-launcher.cjs')
const windowsOnly={skip:process.platform!=='win32'}

test('Windows PowerShell serializes null and empty pipeline results as JSON null',windowsOnly,async()=>{
  for(const source of ['$null','@()','return','@(1) | Where-Object { $_ -eq 2 }']) {
    assert.equal(await powershellJson(source),null,source)
  }
})

test('Windows PowerShell JSON preserves values and Unicode and propagates script errors',windowsOnly,async()=>{
  for(const [source,expected] of [
    ['$false',false],['0',0],["''",''],['1,2',[1,2]],
    ['[pscustomobject]@{profile=$env:CLOSURE_TEST_PROFILE;enabled=$true}',{profile:'C:\\用户\\Codex profile',enabled:true}],
  ]) {
    assert.deepEqual(await powershellJson(source,{CLOSURE_TEST_PROFILE:'C:\\用户\\Codex profile'}),expected)
  }
  await assert.rejects(powershellJson("throw 'closure-test-error'"),/closure-test-error/)
})

test('process discovery returns an empty list when no Codex process matches',windowsOnly,async()=>{
  const executable=`C:\\closure-no-such-codex-${randomUUID()}.exe`
  assert.deepEqual(await getProcesses({executable}),[])
})
