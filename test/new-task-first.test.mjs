import assert from 'node:assert/strict'
import test from 'node:test'
import {createTaskPinsClient} from '../src/pin-client.mjs'
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}}
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve()}
function fixture(pins=['old','new'],order=pins){
 let snapshot={phase:'ready',state:'idle',pinnedSessionIds:[...pins],archivedSessionIds:[]}
 const listeners=new Set(),requests=[],calls=[],writes=[]
 const f={order:[...order],revision:1,requests,calls,writes}
 const payload=()=>({queue:{schemaVersion:1,revision:f.revision,sessionIds:[...f.order],updatedAt:'opaque'},migration:{status:'done'},writable:true})
 f.set=ids=>{snapshot={...snapshot,pinnedSessionIds:[...ids]};for(const notify of listeners)notify()}
 f.respond=(method,body)=>{
  if(method==='POST'){
   assert.equal(body.action,'move')
   if(body.expectedRevision!==f.revision)return {response:{ok:false,status:409},payload:payload()}
   const next=f.order.filter(id=>id!==body.sessionId),index=body.beforeSessionId==null?next.length:next.indexOf(body.beforeSessionId)
   next.splice(index,0,body.sessionId);f.order=next;f.revision++;writes.push([...next])
  }
  return {response:{ok:true,status:200},payload:payload()}
 }
 f.request=(...args)=>f.respond(...args)
 f.pin=async id=>{if(!snapshot.pinnedSessionIds.includes(id)){f.order=[id,...f.order];f.revision++;f.set([...snapshot.pinnedSessionIds,id])}}
 f.client=createTaskPinsClient({request:(...args)=>{requests.push(args);return f.request(...args)}})
 f.off=f.client.connectNative({source:{getSnapshot:()=>snapshot,subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn)}},pinSession:id=>{calls.push(['pin',id]);return f.pin(id)},unpinSession:async id=>{calls.push(['unpin',id]);f.set(snapshot.pinnedSessionIds.filter(value=>value!==id))}})
 f.ids=()=>[...f.client.source.getSnapshot().queue.sessionIds]
 return f
}

test('explicit creation of an already-pinned blank immediately fronts just that task and persists via existing CAS',async()=>{
 const f=fixture(['old','new','third']),write=deferred();await f.client.refresh()
 f.request=(method,body)=>method==='POST'?write.promise.then(()=>f.respond(method,body)):f.respond(method,body)
 const seen=[];const off=f.client.source.subscribe(()=>seen.push(f.ids()))
 const work=f.client.pinCreated('new')
 assert.deepEqual(f.ids(),['new','old','third']);await flush()
 assert.deepEqual(f.calls,[],'already-pinned creation does not alter official Pin order')
 assert.deepEqual(f.requests.find(([method])=>method==='POST')[1],{action:'move',sessionId:'new',beforeSessionId:'old',expectedRevision:1})
 write.resolve();await work
 assert.deepEqual(f.order,['new','old','third']);assert.ok(seen.every(ids=>ids[0]==='new'))
 assert.deepEqual(f.client.source.getSnapshot().pendingSessionIds,[])
 off();f.off()
})

test('a late first GET cannot demote an explicit new task while its order commit is pending',async()=>{
 const f=fixture(),read=deferred(),write=deferred()
 f.request=(method,body)=>method==='GET'?read.promise.then(()=>f.respond(method,body)):write.promise.then(()=>f.respond(method,body))
 const loading=f.client.refresh();await flush()
 const seen=[];const off=f.client.source.subscribe(()=>seen.push(f.ids()))
 const work=f.client.pinCreated('new');assert.equal(f.ids()[0],'new')
 read.resolve();await loading;await flush();assert.equal(f.ids()[0],'new')
 write.resolve();await work
 assert.ok(seen.every(ids=>ids[0]==='new'));assert.deepEqual(f.order,['new','old'])
 off();f.off()
})

test('new membership is never invented before native ack, then immediately appears first even if native appends it',async()=>{
 const f=fixture(['old']),pin=deferred();await f.client.refresh()
 const complete=f.pin;f.pin=id=>pin.promise.then(()=>complete(id))
 const work=f.client.pinCreated('new');assert.deepEqual(f.ids(),['old'])
 pin.resolve();await work;assert.deepEqual(f.ids(),['new','old'])
 assert.deepEqual(f.calls,[['pin','new']]);assert.equal(f.requests.filter(([method])=>method==='POST').length,0)
 f.off()
})

test('duplicate creation flights coalesce and an already-front task needs no extra order write',async()=>{
 const f=fixture(),gate=deferred();await f.client.refresh()
 f.request=(method,body)=>method==='POST'?gate.promise.then(()=>f.respond(method,body)):f.respond(method,body)
 const first=f.client.pinCreated('new');assert.equal(f.client.pinCreated('new'),first)
 gate.resolve();await first;await f.client.pinCreated('new')
 assert.equal(f.writes.length,1);assert.deepEqual(f.calls,[]);f.off()
})

test('rapid creations preserve intent order and never let earlier commits cover the newest task',async()=>{
 const f=fixture(['old','a','b']);await f.client.refresh()
 const a=f.client.pinCreated('a'),b=f.client.pinCreated('b')
 const seen=[];const off=f.client.source.subscribe(()=>seen.push(f.ids()))
 assert.deepEqual(f.ids(),['b','a','old']);await Promise.all([a,b])
 assert.deepEqual(f.writes,[['a','old','b'],['b','a','old']])
 assert.ok(seen.every(ids=>ids[0]==='b'));assert.deepEqual(f.ids(),['b','a','old'])
 off();f.off()
})

test('creation CAS retry rebases to the latest head instead of a stale before-id',async()=>{
 const f=fixture(['a','new','b']);await f.client.refresh()
 let posts=0
 f.request=(method,body)=>{
  if(method==='POST'&&posts++===0){
   assert.equal(body.beforeSessionId,'a')
   f.order=['b','a','new'];f.revision++
   return {response:{ok:false,status:409},payload:f.respond('GET').payload}
  }
  if(method==='POST')assert.equal(body.beforeSessionId,'b')
  return f.respond(method,body)
 }
 const seen=[];const off=f.client.source.subscribe(()=>seen.push(f.ids()))
 await f.client.pinCreated('new')
 assert.deepEqual(f.order,['new','b','a']);assert.ok(seen.every(ids=>ids[0]==='new'))
 off();f.off()
})

test('out-of-order native acknowledgements cannot put an earlier creation above a later one',async()=>{
 const f=fixture(['old']),aGate=deferred(),bGate=deferred();await f.client.refresh()
 const pin=f.pin;f.pin=id=>(id==='a'?aGate:bGate).promise.then(()=>pin(id))
 const a=f.client.pinCreated('a'),b=f.client.pinCreated('b')
 await flush();bGate.resolve();await flush();assert.equal(f.ids()[0],'b')
 const seen=[];const off=f.client.source.subscribe(()=>seen.push(f.ids()))
 aGate.resolve();await Promise.all([a,b])
 assert.deepEqual(f.order,['b','a','old']);assert.ok(seen.every(ids=>ids[0]==='b'))
 off();f.off()
})

test('order failure is explicit and cannot roll back confirmed native membership',async()=>{
 const f=fixture();await f.client.refresh()
 f.request=(method,body)=>method==='POST'?{response:{ok:false,status:500},payload:{message:'disk unavailable'}}:f.respond(method,body)
 await assert.rejects(f.client.pinCreated('new'),/disk unavailable/)
 assert.ok(f.ids().includes('new'));assert.deepEqual(f.calls,[])
 assert.equal(f.client.source.getSnapshot().error,'disk unavailable');f.off()
})
