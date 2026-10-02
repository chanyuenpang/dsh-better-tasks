// Nonvisual startup assertions on the actual Electron renderer. Sandbox only.
import fs from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {createHash} from 'node:crypto'
import assert from 'node:assert/strict'
const base=resolve(process.argv[2]??'sandbox/.desktop-startup-027')
const mode=process.argv[3]??'enabled'
const runId=process.argv[4]??mode
assert.ok(['enabled','disabled'].includes(mode))
const baseline=JSON.parse(await fs.readFile(join(base,'baseline.json'),'utf8'))
const pages=await (await fetch('http://127.0.0.1:9228/json/list')).json()
const page=pages.find(x=>x.url==='dsh-app://app/')
assert.ok(page,'actual app-protocol Desktop renderer required')
const ws=new WebSocket(page.webSocketDebuggerUrl)
await new Promise((ok,no)=>{ws.addEventListener('open',ok,{once:true});ws.addEventListener('error',no,{once:true})})
let sequence=0
const pending=new Map(),errors=[]
ws.addEventListener('message',({data})=>{const m=JSON.parse(data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);if(p)m.error?p.reject(new Error(m.error.message)):p.resolve(m.result)}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description??m.params.exceptionDetails.text);else if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')errors.push(m.params.args.map(x=>x.value??x.description).join(' '))})
const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}))})
const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value}
const until=async expression=>{for(let i=0;i<200;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,100))}throw new Error('Readiness timeout: '+expression)}
const hash=x=>createHash('sha256').update(x).digest('hex')
const normalize=x=>x.replace(/(?:\r?\n)?\/\/# sourceURL=[^\r\n]*(?:\r?\n)?$/,'').replace(/(?:\r?\n)?\/\/# sourceMappingURL=[^\r\n]*(?:\r?\n)?$/,'').trimEnd()+'\n'
try{
 await send('Runtime.enable');await send('Page.enable')
 // Capture the module-system return value without replacing factories, services,
 // graph entries or activation. Read only after the ordinary boot has completed.
 await send('Page.addScriptToEvaluateOnNewDocument',{source:`(() => {let facade;Object.defineProperty(window,'__ModuleLoader__',{configurable:true,get(){return facade},set(value){facade=value;if(!value||value.__repairCaptured)return;value.__repairCaptured=true;const create=value.create;value.create=function(...args){const result=Reflect.apply(create,this,args);window.__repairSystem=result;return result}}})})()`})
 await send('Page.reload',{ignoreCache:true})
 await until('Boolean(window.__repairSystem?.entries?.loader)')
 await evaluate("[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='继续')?.click()")
 await until("Boolean(document.querySelector('[contenteditable=true]'))")
 const core=await evaluate(`(() => {const system=window.__repairSystem;const active=2; /* Cordis const enum: packages/client/modules/src/client/entries.ts:25 */return {url:location.href,desktopPreload:!!window.dshDesktop,active,entries:[...system.entries.loader.entries()].map(e=>({name:e.options.name,state:e.fiber?.state})),failures:system.entries.state.getSnapshot().failures,services:{workspace:!!system.entries.loader.ctx.get('uiWorkspace'),conversation:!!system.entries.loader.ctx.get('uiConversation'),pins:!!system.entries.loader.ctx.get('betterTaskPins')},sidebar:!!document.querySelector('.dbt-sidebar'),conversation:!!document.querySelector('[contenteditable=true]')}})()`)
 assert.equal(core.url,'dsh-app://app/');assert.ok(core.desktopPreload)
 assert.equal(typeof core.active,'number')
 assert.deepEqual(core.failures,[])
 const inactive=core.entries.filter(x=>x.state!==core.active)
 assert.deepEqual(inactive,[],'all top-level client entries must activate')
 for(const name of ['ui-workspace','ui-conversation','ui-goal','ui-plan','ui-trajectory','ui-deliverables','ui-user-questions'])assert.ok(core.entries.some(x=>x.name===`@deepseek-ai/dsh-client-${name}`),name+' present')
 assert.ok(core.services.workspace&&core.services.conversation)
 assert.equal(core.services.pins,mode==='enabled')
 assert.equal(core.sidebar,mode==='enabled')
 const served=[]
 for(const candidate of baseline.candidates){
  if(mode==='disabled'&&candidate.slug==='better-tasks')continue
  const row=await evaluate(`window.__DSH_BOOT__.entries.find(x=>x.id===${JSON.stringify(candidate.name)})`)
  assert.ok(row,'fork entry present even with provider disabled: '+candidate.name)
  const bytes=await evaluate(`fetch(new URL(${JSON.stringify(row.url)},location.href)).then(async r=>{if(!r.ok)throw Error('bundle HTTP '+r.status);return r.text()})`)
  let disk
   try { disk=await fs.readFile(join(baseline.profile,'node_modules',candidate.name,'lib/client.js'),'utf8') }
   catch(error) {
    if(error.code!=='ENOENT')throw error
    disk=await fs.readFile(join(baseline.profile,'node_modules','@veewo/dsh-better-tasks','node_modules',candidate.name,'lib/client.js'),'utf8')
   }
  assert.equal(hash(disk),candidate.clientSha256)
  await fs.writeFile(join(base,`${runId}.served-${candidate.slug}.js`),bytes)
  // DSH comboScript adds a semicolon separator after EACH prepared resource
  // (modules/src/index.ts:403), even for a single-resource URL.
  const prepared=disk.replace(/(?:\r?\n)?\/\/# sourceURL=[^\r\n]*(?:\r?\n)?$/,'').replace(/(?:\r?\n)?\/\/# sourceMappingURL=[^\r\n]*(?:\r?\n)?$/,'')
  const expectedServed=(prepared.endsWith('\n')?prepared:prepared+'\n')+';\n'
  assert.equal(hash(normalize(bytes)),hash(normalize(expectedServed)),'served executable differs from installed candidate: '+candidate.name)
  served.push({name:candidate.name,url:row.url,rawClientSha256:hash(disk),servedExecutableSha256:hash(normalize(bytes))})
 }
 // Startup only: do not navigate to task panels or exercise feature behavior.
 const log=await fs.readFile(join(base,runId+'.err.log'),'utf8')
 assert.doesNotMatch(log,/missed the module table|did not activate|waiting for service: betterTaskPins/)
 assert.deepEqual(errors,[])
 const report={result:'PASS',mode,checkedAt:new Date().toISOString(),core,served,errors,startupOnly:true}
 await fs.writeFile(join(base,runId+'.acceptance.json'),JSON.stringify(report,null,2)+'\n')
 console.log(JSON.stringify(report,null,2))
}catch(error){console.error(error);console.log(JSON.stringify({errors,text:await evaluate('document.body.innerText').catch(()=>null)},null,2));process.exitCode=1}
finally{ws.close()}
