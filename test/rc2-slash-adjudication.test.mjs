import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import test from 'node:test'

// Execute the exact rc.2 overlay methods, not the generic/default .srcbuild line.
// The pre-fix main-composer path emits the reported reading-'catch' TypeError;
// wrapping void in Promise.resolve would hide that but release surfaces early.
const source=readFileSync(new URL('../src-overlay/ui-conversation/0.2.2-rc.2/client/input/facade.ts',import.meta.url),'utf8')
const method=name=>{
  const start=source.indexOf('  private '+name+'(')
  assert.ok(start>=0)
  return source.slice(start,source.indexOf('\n  /**',start))
}
const Target=new Function(stripTypeScriptTypes(['class Target {',method('adjudicate'),method('trackOperation'),'}'].join('\n'))+';return Target')()
const lifetimeSource=readFileSync(new URL('../src-overlay/ui-conversation/0.2.2-rc.2/client/input/surface-lifetime.ts',import.meta.url),'utf8')
const createLifetime=new Function(stripTypeScriptTypes(lifetimeSource).replace(/^export /gm,'')+';return createSurfaceLifetime')()
const machineSource=readFileSync(new URL('./fixtures/conversation-rc2/machine.ts',import.meta.url),'utf8')
const Machine=new Function(stripTypeScriptTypes(machineSource).replace(/^export /gm,'')+';return SubmitMachine')()
const tick=()=>new Promise(resolve=>setImmediate(resolve))
function fixture({provider=true,surface=false}={}){
  let resolve,reject,flights=0
  const pending=new Promise((yes,no)=>{resolve=yes;reject=no})
  const events=[],notices=[],calls=[],x=new Target()
  x.disposed=false;x.attachmentIds=[]
  x.dead=()=>x.disposed
  x.dispatchRun=event=>events.push(event)
  x.notify=(level,text)=>notices.push({level,text})
  x.deps={inputTriggers:()=>provider?{adjudicate:(...args)=>{calls.push(args);return pending}}:undefined}
  if(surface)x.deps.withOperation=async operation=>{flights++;try{return await operation()}finally{flights--}}
  const attempt={signal:new AbortController().signal}
  return {x,attempt,events,notices,calls,resolve,reject,flights:()=>flights,
    submit:()=>x.trackOperation(()=>x.adjudicate(attempt,' /knowledge-capture '))}
}
test('rc.2 main slash submission has no false catch toast while arbitration settles',async()=>{
  const f=fixture();f.submit()
  assert.deepEqual(f.notices,[])
  assert.equal(f.calls[0][0],'/knowledge-capture')
  assert.equal(f.calls[0][1],f.attempt.signal)
  assert.deepEqual(f.events,[])
  f.resolve(undefined);await tick()
  assert.deepEqual(f.events,[{type:'adjudicated',attempt:f.attempt,outcome:undefined}])
  assert.deepEqual(f.notices,[])
})
test('rc.2 missing pipeline still returns a Promise and preserves ordinary-message fallback',async()=>{
  const f=fixture({provider:false})
  const returned=f.x.adjudicate(f.attempt,'/knowledge-capture')
  assert.equal(typeof returned?.then,'function');await returned
  assert.deepEqual(f.events,[{type:'adjudicated',attempt:f.attempt,outcome:undefined}])
  assert.deepEqual(f.notices,[])
})
test('rc.2 detached surface stays in flight until the actual arbitration settles',async()=>{
  const f=fixture({surface:true});f.submit();await tick()
  assert.equal(f.flights(),1,'must not settle a void placeholder before arbitration')
  const outcome={claim:{name:'example'}}
  f.resolve(outcome);await tick()
  assert.equal(f.flights(),0);assert.equal(f.events[0].outcome,outcome)
  assert.deepEqual(f.notices,[])
})
test('rc.2 rejection keeps the existing adjudication-failed path without a second toast',async()=>{
  const f=fixture();f.submit();f.reject(new Error('arbitration failed'));await tick()
  assert.deepEqual(f.events,[{type:'adjudication-failed',attempt:f.attempt,message:'arbitration failed'}])
  assert.deepEqual(f.notices,[])
})
test('rc.2 disposed input drops late arbitration without publishing an error',async()=>{
  const f=fixture();f.submit();f.x.disposed=true;f.resolve(undefined);await tick()
  assert.deepEqual(f.events,[]);assert.deepEqual(f.notices,[])
})
for(const abort of [false,true])test('real rc.2 machine and lifetime hold delayed arbitration through close; abort='+abort,async()=>{
  const f=fixture(),machine=new Machine();let releases=0,closes=0,sends=0
  const life=createLifetime({close:()=>{closes++},release:()=>{releases++;f.x.disposed=true}})
  f.x.deps.withOperation=life.withOperation
  f.x.dead=attempt=>f.x.disposed||attempt.signal.aborted
  f.x.dispatchRun=event=>{for(const effect of machine.dispatch(event)){if(effect.type==='default-sink')sends++}}
  const [effect]=machine.dispatch({type:'enter',mode:'prompt',draft:'/knowledge-capture',occurrences:[],quotes:[],attachmentIds:[]})
  assert.equal(effect.type,'adjudicate')
  f.x.trackOperation(()=>f.x.adjudicate(effect.attempt,effect.draft))
  life.dispose();life.dispose();if(abort)machine.dispatch({type:'release'})
  await tick();assert.equal(life.flights,1);assert.equal(releases,0);assert.equal(closes,1)
  await assert.rejects(life.withOperation(()=>{sends++}),/closing/)
  f.resolve('handled');await life.closed
  assert.equal(releases,1);assert.equal(life.flights,0);assert.equal(sends,0);assert.deepEqual(f.notices,[])
})

test('rc.2 synchronous provider errors retain the original single error notice',()=>{
  const f=fixture();f.x.deps.inputTriggers=()=>({adjudicate:()=>{throw new Error('provider failed')}})
  f.submit()
  assert.deepEqual(f.notices,[{level:'error',text:'provider failed'}])
})
