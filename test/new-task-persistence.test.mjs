import assert from 'node:assert/strict'
import test from 'node:test'
import {createNativePinHost} from '../src/native-pin-host.mjs'
import {createTaskPinsClient} from '../src/pin-client.mjs'

test('new-task front insertion is committed by the real Host and survives refresh/recreation until a manual move',async()=>{
 const records=new Map([['global',{schemaVersion:1,revision:1,sessionIds:['old','new','tail'],updatedAt:'opaque',migration:{status:'done',sourceRevision:null,entries:[]}}]])
 const listeners=new Set(),writes=[]
 const registry={pinnedSessionIds:['old','new','tail'],archivedSessionIds:[],pinSession:async()=>{throw Error('Existing official Pin must not be rewritten')},unpinSession:async()=>{throw Error('No Unpin expected')}}
 const table={get:id=>structuredClone(records.get(id)),put:async(id,value)=>{records.set(id,structuredClone(value));writes.push(structuredClone(value))},update:async(id,fn)=>{await table.put(id,fn(structuredClone(records.get(id))));return structuredClone(records.get(id))}}
 const launch=async()=>{
  const host=createNativePinHost({registry,now:()=> 'opaque-commit',openOrder:async()=>({table,close:async()=>{}}),openLegacy:async()=>{throw Error('No legacy scan expected')},subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn)}})
  host.read();await host.settled()
  const client=createTaskPinsClient({request:async(method,body)=>({response:{ok:true,status:200},payload:method==='GET'?host.read():await host.mutate(body)})})
  const off=client.connectNative({source:{getSnapshot:()=>({phase:'ready',state:'idle',pinnedSessionIds:registry.pinnedSessionIds,archivedSessionIds:[]}),subscribe:()=>()=>{}},pinSession:registry.pinSession,unpinSession:registry.unpinSession})
  await client.refresh()
  return {client,host,close:async()=>{off();await host.dispose()}}
 }
 let app=await launch()
 await app.client.pinCreated('new')
 assert.deepEqual(records.get('global').sessionIds,['new','old','tail'],'explicit creation must commit the complete front order')
 assert.ok(writes.length>0)
 await app.client.refresh();assert.deepEqual(app.client.source.getSnapshot().queue.sessionIds,['new','old','tail'])
 await app.close()
 app=await launch()
 assert.deepEqual(app.client.source.getSnapshot().queue.sessionIds,['new','old','tail'],'fresh Host/Client must restore the saved order, not native array order')
 await app.client.refresh();await app.client.refresh()
 assert.deepEqual(app.client.source.getSnapshot().queue.sessionIds,['new','old','tail'])
 await app.client.moveBefore('old','new')
 assert.deepEqual(records.get('global').sessionIds,['old','new','tail'])
 await app.close()
 app=await launch()
 assert.deepEqual(app.client.source.getSnapshot().queue.sessionIds,['old','new','tail'],'an explicit later manual order must also survive recreation')
 assert.deepEqual(registry.pinnedSessionIds,['old','new','tail'],'official Pin order remains untouched')
 await app.close();assert.equal(listeners.size,0)
})
