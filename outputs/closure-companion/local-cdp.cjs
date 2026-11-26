// Loopback-only CDP transport shared by the WorkBuddy companion connector.
function validateEndpoint(url, port) {
  const value = new URL(url)
  if (value.protocol !== 'ws:' || !['127.0.0.1', '[::1]'].includes(value.hostname) ||
      Number(value.port) !== port || value.username || value.password || value.search || value.hash ||
      !/^\/devtools\/(browser|page)\/[\w-]+$/.test(value.pathname)) throw Error('Invalid local bridge endpoint')
}
async function connect(url, port) {
  validateEndpoint(url, port)
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url), pending = new Map()
    let sequence = 0
    const timeout = setTimeout(() => { ws.close(); reject(Error('Bridge connection timed out')) }, 5000)
    const client = { closed: false, send(method, params = {}) {
      if (client.closed) return Promise.reject(Error('Bridge disconnected'))
      const id = ++sequence
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(Error('Bridge request timed out')) }, 15000)
        pending.set(id, { resolve, reject, timer })
        try { ws.send(JSON.stringify({ id, method, params })) }
        catch (e) { clearTimeout(timer); pending.delete(id); reject(e) }
      })
    }, close() { ws.close() } }
    ws.addEventListener('open', () => { clearTimeout(timeout); resolve(client) })
    ws.addEventListener('message', event => {
      let value
      try { value = JSON.parse(event.data) } catch { return }
      const item = pending.get(value.id)
      if (!item) return
      pending.delete(value.id); clearTimeout(item.timer)
      if (value.error) item.reject(Error('WorkBuddy bridge request failed')); else item.resolve(value.result)
    })
    ws.addEventListener('error', () => { clearTimeout(timeout); reject(Error('Bridge connection failed')) })
    ws.addEventListener('close', () => {
      clearTimeout(timeout); client.closed = true; reject(Error('Bridge disconnected'))
      for (const item of pending.values()) { clearTimeout(item.timer); item.reject(Error('Bridge disconnected')) }
      pending.clear()
    })
  })
}
async function evaluate(client, expression) {
  const result = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: false })
  if (result.exceptionDetails) throw Error('WorkBuddy companion API unavailable')
  return result.result?.value
}
module.exports = { connect, evaluate, validateEndpoint }
