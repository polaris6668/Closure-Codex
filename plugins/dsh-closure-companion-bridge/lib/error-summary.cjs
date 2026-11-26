const errorTypes = new Map(Object.entries({
  contextwindowexceeded: '超出模型上下文长度',
  sessionbudgetexceeded: '已达到会话预算上限',
  usagelimitexceeded: '已达到使用额度上限',
  ratelimitexceeded: '请求频率受限',
  serveroverloaded: '服务繁忙',
  flexunavailable: 'Flex 服务暂不可用',
  modelnotfound: '找不到所选模型',
  internalservererror: '服务端内部错误',
  unauthorized: '身份验证失败',
  badrequest: '请求参数无效',
  policycapacityunavailable: '当前无法处理这项请求',
  inferencehookdenied: '请求被配置的推理钩子拒绝',
  sandboxerror: '沙箱限制或执行错误',
  toomanydenials: '操作多次被拒绝',
  threadrollbackfailed: '对话回滚失败',
  httpconnectionfailed: '无法连接服务',
  responsestreamconnectionfailed: '无法建立响应连接',
  responsestreamdisconnected: '响应连接中断',
  responsetoomanyfailedattempts: '多次重试后仍失败',
}))

const httpReasons = new Map([
  [400, '请求参数无效'], [401, '身份验证失败'], [403, '权限不足或访问被拒绝'],
  [404, '资源或接口不存在'], [408, '请求超时'], [429, '请求频率或额度受限'],
  [500, '服务端内部错误'], [502, '上游服务响应异常'], [503, '服务暂不可用'], [504, '上游请求超时'],
])

const rpcReasons = new Map([
  [-32700, '服务无法解析请求'], [-32600, '请求格式无效'], [-32601, '服务未提供此工具'],
  [-32602, '工具参数无效'], [-32603, '服务端内部错误'],
])

const textReasons = [
  [/transport channel closed|\beconnreset\b|broken pipe|stream disconnected|connection (?:closed|reset)|连接中断/i, '服务连接中断'],
  [/could not start mcp|mcp startup failed|handshak(?:e|ing) failed/i, 'MCP 服务启动或握手失败'],
  [/timed?\s*out|\betimedout\b|deadline exceeded|超时/i, '请求超时'],
  [/\benotfound\b|\beai_again\b|dns (?:lookup|resolution)|name resolution/i, '域名解析失败'],
  [/\beconnrefused\b|connection refused|连接被拒绝/i, '服务拒绝连接'],
  [/\b(?:tls|ssl)\b|certificate (?:verify|validation|expired)/i, 'TLS 连接或证书校验失败'],
  [/quota exceeded|insufficient.quota|usage limit|额度不足/i, '已达到使用额度上限'],
  [/rate.limit|too many requests|限流/i, '请求频率受限'],
  [/invalid.token|invalid.api.key|unauthori[sz]ed|authentication failed|认证失败/i, '身份验证失败'],
  [/permission denied|access denied|forbidden|权限不足/i, '权限不足或访问被拒绝'],
  [/invalid (?:params|arguments)|bad request|参数无效/i, '请求参数无效'],
  [/method not found|unknown tool|tool not found/i, '服务未提供此工具'],
  [/context (?:window|length)|上下文.{0,8}(?:超出|过长)/i, '超出模型上下文长度'],
  [/model (?:not found|does not exist)/i, '找不到所选模型'],
  [/server (?:overloaded|unavailable)|service unavailable/i, '服务繁忙或暂不可用'],
]

function summarizeError(error) {
  if (!error) return ''
  const info = error.codex_error_info ?? error.codexErrorInfo
  const type = typeof info === 'string' ? info : Object.keys(info || {})[0]
  const category = errorTypes.get(type?.replace(/[^a-z]/gi, '').toLowerCase())
  const details = typeof info === 'object' && info ? info[type] : null
  const message = typeof error === 'string' ? error.slice(0, 4096)
    : typeof error.message === 'string' ? error.message.slice(0, 4096) : ''
  const code = details?.httpStatusCode ?? details?.http_status_code ??
    message.match(/\b(?:HTTP(?:\/\d(?:\.\d)?)?|(?:status(?: code)?|response code))\s*[:=]?\s*([45]\d{2})\b/i)?.[1]
  const http = /^[45]\d{2}$/.test(String(code)) ? Number(code) : null
  if (http) return `${httpReasons.get(http) || category || '服务请求失败'}（HTTP ${http}）`
  const rpc = Number(error.code ?? message.match(/\b(?:mcp (?:error|code)|json.rpc (?:error|code))\s*:?\s*(-\d{5})\b/i)?.[1])
  if (rpcReasons.has(rpc)) return `${rpcReasons.get(rpc)}（${rpc}）`
  return category || textReasons.find(([pattern]) => pattern.test(message))?.[1] || ''
}

function summarizeToolError(item) {
  const result = item.result
  const error = summarizeError(item.error) || summarizeError(result?.structuredContent?.error)
  if (error || !Array.isArray(result?.content)) return error
  for (const block of result.content.slice(0, 4)) {
    const reason = block?.type === 'text' && summarizeError(block.text)
    if (reason) return reason
  }
  return ''
}

module.exports = { summarizeError, summarizeToolError }
