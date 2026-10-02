// Caller must verify CDP listener ownership against the sandbox process record.
const response=await fetch('http://127.0.0.1:9228/json/version')
const {webSocketDebuggerUrl}=await response.json()
const ws=new WebSocket(webSocketDebuggerUrl)
await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true})})
const closed=new Promise(resolve=>ws.addEventListener('close',resolve,{once:true}))
ws.send(JSON.stringify({id:1,method:'Browser.close'}))
await closed
console.log('Closed owned sandbox Electron through its CDP endpoint')
