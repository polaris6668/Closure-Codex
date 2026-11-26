function validateEndpoint(url, port) {
  const parsed = new URL(url)
  if (parsed.protocol !== 'ws:' || !['127.0.0.1','[::1]'].includes(parsed.hostname) ||
      Number(parsed.port) !== port || parsed.username || parsed.password ||
      parsed.search || parsed.hash || !/^\/devtools\/(browser|page)\/[A-Za-z0-9_-]+$/.test(parsed.pathname)) throw new Error('Unexpected CDP endpoint')
  return url
}

async function connect(url, port) {
  validateEndpoint(url, port)
  return new Promise((resolve,reject) => {
    const ws = new WebSocket(url)
    const pending = new Map()
    let sequence = 0
    const timeout = setTimeout(() => { ws.close(); reject(new Error('CDP connection timeout')) },5000)
    const client = {
      closed:false,
      send(method,params={}) {
        if(client.closed)return Promise.reject(new Error('CDP connection closed'))
        const id=++sequence
        return new Promise((res,rej) => {
          const timer=setTimeout(() => {pending.delete(id);rej(new Error(`CDP command timeout: ${method}`))},5000)
          pending.set(id,{res,rej,timer})
          try { ws.send(JSON.stringify({id,method,params})) }
          catch(error) { clearTimeout(timer);pending.delete(id);rej(error) }
        })
      },
      close() { ws.close() },
    }
    ws.addEventListener('open',() => {clearTimeout(timeout);resolve(client)})
    ws.addEventListener('message',event => {
      const value=JSON.parse(event.data)
      const item=pending.get(value.id)
      if(!item)return
      pending.delete(value.id);clearTimeout(item.timer)
      if(value.error)item.rej(new Error(value.error.message));else item.res(value.result)
    })
    ws.addEventListener('error',() => {clearTimeout(timeout);reject(new Error('CDP socket error'))})
    ws.addEventListener('close',() => {
      clearTimeout(timeout);client.closed=true;reject(new Error('CDP connection closed'))
      for(const item of pending.values()){clearTimeout(item.timer);item.rej(new Error('CDP connection closed'))}
      pending.clear()
    })
  })
}

async function evaluate(client, expression) {
  const result=await client.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:false})
  if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text)
  return result.result?.value
}

module.exports = { connect,evaluate,validateEndpoint }
