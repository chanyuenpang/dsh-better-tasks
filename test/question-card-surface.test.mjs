import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
const ts=createRequire(new URL('../.srcbuild/package.json',import.meta.url))('typescript')
const root=new URL('../.srcbuild/packages/client/ui-user-questions/src/client/',import.meta.url)
const source=name=>readFileSync(new URL(name,root),'utf8')
const load=(name,deps={})=>{const module={exports:{}};const code=ts.transpileModule(source(name),{fileName:name,compilerOptions:{target:ts.ScriptTarget.ESNext,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;new Function('module','exports','require',code)(module,module.exports,id=>{if(!(id in deps))throw Error('Unexpected dependency '+id);return deps[id]});return module.exports}
const snapshot=initial=>{let value=initial;const listeners=new Set();return{getSnapshot:()=>value,subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn)},set:next=>{value=next;for(const fn of [...listeners])fn()}}}
const storeApi={createSnapshotStore:snapshot,defineStore:spec=>({spec,create:scopeKey=>{const state=snapshot(spec.init());return{...state,persistKey:spec.persist+'.'+scopeKey,actions:Object.fromEntries(Object.entries(spec.actions).map(([key,run])=>[key,(...args)=>{const next=structuredClone(state.getSnapshot());run(next,...args);state.set(next)}]))}}})}
const slots=load('contract/slots.ts')
const drafts=load('draft-store.ts',{'@deepseek-ai/dsh-client-store':storeApi})
const {QuestionSurfaceRegistry}=load('question-surface.ts',{'./draft-store.ts':drafts})
const React={createElement:(type,props,...children)=>({type,props,children}),useSyncExternalStore:(_subscribe,get)=>get()}
const surfaces=load('surface-card.tsx',{'react':React,'@deepseek-ai/dsh-client-store':storeApi,'./contract/slots.ts':slots,'./QuestionComposer.tsx':{QuestionSurface:'QuestionSurface'}})
const makePending=(id='a',call='call')=>new slots.PendingQuestion(id,[{id:'q',question:'Choose',options:[{label:'A'},{label:'B'}]}],call,()=>[slots.PendingQuestion.keyOf(id,call)])
function fixture(pending=makePending()){
 const cardsMap=new Map([[pending.key,pending]]),bindings=new Map(),subscribers=new Map();let retained=0,released=0
 const questions=snapshot({active:[]}),inbox=snapshot({'next-step':[],'next-turn':[]}),session=snapshot({removed:false,openState:'open'})
 const context=()=>({effect:factory=>{const off=factory();return()=>off?.()}})
 const binding={ctx:context(),session:{...session,projections:{faceOf:name=>name==='userQuestions'?questions:inbox}}}
 bindings.set(pending.sessionId,binding)
 const list=snapshot({ids:[pending.sessionId],byId:{[pending.sessionId]:{id:pending.sessionId}},projectionsBySession:{}})
 const sessions={binding:id=>bindings.get(id),list,retain:id=>{retained++;const exact=bindings.get(id);let live=true;return{binding:exact,ready:Promise.resolve(exact),release(){if(live){live=false;released++}}}}}
 const ctx={...context(),get:key=>key==='sessions'?sessions:key==='uiSession'?{sessionStatus:snapshot(new Map())}:undefined}
 const cards={source:key=>cardsMap.get(key),values:()=>[...cardsMap.values()].map(pending=>({pending})),subscribe:(key,fn)=>{let set=subscribers.get(key);if(!set)subscribers.set(key,set=new Set());set.add(fn);return()=>set.delete(fn)}}
 const registry=new QuestionSurfaceRegistry({isCurrent:p=>cards.source(p.key)===p,bindingOf:id=>bindings.get(id),runOperation:(record,send)=>surfaces.runQuestionOperation(ctx,record,send),resubmitMessage:()=> 'resubmit'})
 return{ctx,cards,registry,binding,bindings,session,list,questions,inbox,pending,remove(){cardsMap.delete(pending.key);for(const fn of subscribers.get(pending.key)??[])fn()},counts:()=>({retained,released})}
}
test('native Slot and card share one persisted store per Session, with isolated pruning',()=>{
 const f=fixture(),a=f.registry.draftStore.create('a'),b=f.registry.storeFor('b')
 assert.equal(a,f.registry.storeFor('a'));assert.notEqual(a,b);assert.equal(a.persistKey,'dsh.user-questions.drafts.v1.a')
 a.actions.replace('a-call',{index:0,drafts:[{selected:['A'],custom:'',skipped:false}]})
 b.actions.replace('b-call',{index:0,drafts:[{selected:['B'],custom:'',skipped:false}]})
 a.actions.prune([]);assert.ok(b.getSnapshot().progressByRequest['b-call'])
})
test('one shared settlement gate rejects duplicates and unlocks the same call on failure',async()=>{
 const f=fixture(),record=f.registry.record(f.pending),token=f.registry.beginSettlement(record)
 assert.equal(f.registry.beginSettlement(record),undefined)
 await assert.rejects(f.registry.settle(record,token,()=>Promise.reject(Error('network')),'rpc'),/network/)
 assert.equal(record.locked,false);assert.equal(record.error,'network')
 const retry=f.registry.beginSettlement(record);await f.registry.settle(record,retry,async()=>{},'rpc')
 assert.equal(record.locked,true);assert.deepEqual(f.counts(),{retained:2,released:2})
})
test('a sent waterfall can rearm only after settling into continued state',async()=>{
 const f=fixture(),record=f.registry.record(f.pending),token=f.registry.beginSettlement(record)
 await f.registry.settle(record,token,async()=>{},'waterfall');assert.equal(record.locked,true)
 f.pending.setState('continued');assert.equal(record.locked,false);assert.equal(record.error,'resubmit')
})
test('stale binding cannot dispatch a response',async()=>{
 const f=fixture(),record=f.registry.record(f.pending),token=f.registry.beginSettlement(record);f.bindings.set('a',{})
 let sent=false;await assert.rejects(f.registry.settle(record,token,async()=>{sent=true},'rpc'),/no longer current/);assert.equal(sent,false)
})
test('retained ordinary card renders the native View and releases on exact owner removal',async()=>{
 const f=fixture();f.pending.setState('continued');f.pending.attachRpc({answer:async()=>true})
 const h=await surfaces.createQuestionCard(f.ctx,f.cards,f.registry,()=>{},{sessionId:'a',callId:'call'},key=>key)
 assert.equal(h.state.getSnapshot().phase,'ready');assert.equal(h.View({fontSize:18}).props.style['--dsh-question-card-font-size'],'18px')
 f.remove();await h.closed;assert.equal(h.state.getSnapshot().phase,'closed');assert.deepEqual(f.counts(),{retained:1,released:1})
})
test('card disposal drains admitted response independently and never dismisses the question',async()=>{
 const f=fixture();f.pending.setState('continued');f.pending.attachRpc({answer:async()=>true})
 let dismiss=0;f.pending.dismiss=async()=>{dismiss++}
 const h=await surfaces.createQuestionCard(f.ctx,f.cards,f.registry,()=>{},{sessionId:'a',requestKey:f.pending.key},key=>key)
 const record=f.registry.record(f.pending),token=f.registry.beginSettlement(record)
 let resolve;const operation=f.registry.settle(record,token,()=>new Promise(done=>{resolve=done}),'rpc')
 h.dispose();assert.equal(h.state.getSnapshot().phase,'closed');assert.equal(f.counts().released,0)
 resolve();await operation;await h.closed;assert.equal(dismiss,0);assert.deepEqual(f.counts(),{retained:2,released:2})
})
test('queued continued replies are not discovered or exposed as answerable',async()=>{
 const f=fixture();f.pending.setState('continued');f.pending.attachRpc({answer:async()=>true})
 f.inbox.set({'next-step':[{source:{kind:'user-question-reply',callId:'call'}}],'next-turn':[]})
 assert.equal(surfaces.findQuestionCard(f.ctx,f.cards,'a'),undefined)
 const h=await surfaces.createQuestionCard(f.ctx,f.cards,f.registry,()=>{},{sessionId:'a',callId:'call'},key=>key);await h.closed
 assert.equal(h.state.getSnapshot().phase,'closed')
})
test('mismatched key/call identity is rejected before retaining a Session',async()=>{
 const f=fixture();await assert.rejects(surfaces.createQuestionCard(f.ctx,f.cards,f.registry,()=>{},{sessionId:'a',callId:'wrong',requestKey:f.pending.key},key=>key),/disagree/)
 assert.deepEqual(f.counts(),{retained:0,released:0})
})
test('per-view focus owners prevent one unmount from releasing the other view',()=>{
 const pending=makePending(),a={},b={};pending.holdFocus(10,a);pending.holdFocus(11,b);pending.releaseFocus(12,a)
 assert.equal(pending.snapshot().countdown,undefined)
 // Remaining focus ownership is independently retained even without a timed channel.
 pending.releaseFocus(13,b);pending.holdFocus(14,a);pending.releaseFocus(15,a)
})
test('card interaction and typography remain scoped; no autofocus or borrowed plan Slot',()=>{
 const composer=source('QuestionComposer.tsx'),index=source('index.ts'),card=source('surface-card.tsx')
 assert.match(composer,/autoFocus=\{!cardSurface/)
 assert.match(composer,/const domId = useId\(\)/)
 assert.match(composer,/pending\.holdFocus\(Date\.now\(\), focusOwner\.current\)/)
 assert.match(index,/store: registry\.draftStore/)
 assert.match(index,/dsh-question-card-font-size/)
 assert.match(card,/phase: 'unsupported', kind: 'plan-review'/)
 assert.doesNotMatch(card,/openSession\(|\.reveal\(|pending\.dismiss\(|pending\.delegate\(/)
})
