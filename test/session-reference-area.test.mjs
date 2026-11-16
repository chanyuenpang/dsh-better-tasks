import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {stripTypeScriptTypes} from 'node:module'
import test from 'node:test'
import {Context, Service} from '@deepseek-ai/cordis'
import {isSessionReferenceDrag, writeSessionReferenceDrag} from '../src/session-reference-drag.mjs'
const root='.srcbuild/packages/client/ui-conversation/src/client/'
const strip=code=>stripTypeScriptTypes(code,{mode:'transform'}).replace(/^import .*$/gm,'').replace(/^export /gm,'').replace(/^export\s*\{\s*\};?\s*$/gm,'')
const dropCode=strip(readFileSync(root+'input/session-reference-drop.ts','utf8'))
const {createSessionReferenceInsertion,SessionReferenceDropTransaction}=new Function(dropCode+';return {createSessionReferenceInsertion,SessionReferenceDropTransaction}')()
const apply=readFileSync(root+'apply.ts','utf8'),lookup=apply.match(/resolve: \(\) => (ctx\.get\([^\n]+),\n/)?.[1]
assert.ok(lookup)
const resolveFor=ctx=>new Function('ctx','return '+lookup)(ctx)
class FakeNode {}
const {SessionReferenceDropZone}=new Function('createContext','isSessionReferenceDrag','Node',strip(readFileSync(root+'input/session-reference-drop-zone.ts','utf8'))+';return {SessionReferenceDropZone}')(()=>({}),isSessionReferenceDrag,FakeNode)
class Transfer {
  data=new Map(); effectAllowed='none'; dropEffect='none'; extra=[]
  get types(){return [...this.data.keys(),...this.extra]}
  setData(k,v){this.data.set(k,v)}
  getData(k){return this.data.get(k)??''}
}
const transfer=()=>{const t=new Transfer();writeSessionReferenceDrag(t,'source',true);return t}
function event(t=transfer(),root={contains:()=>false}){
 return {dataTransfer:t,currentTarget:root,target:{closest:()=>root},relatedTarget:null,defaultPrevented:false,stopped:false,
 preventDefault(){this.defaultPrevented=true},stopPropagation(){this.stopped=true}}
}
const flush=async()=>{for(let i=0;i<16;i++)await Promise.resolve()}
function target(resolve){
 const rows=[],life={retains:0,releases:0},binding={session:{getSnapshot:()=>({openState:'open'})}},state={binding,rev:7}
 const sessions={binding:()=>state.binding,async using(id,opts,run){life.retains++;try{return await run({binding})}finally{life.releases++}}}
 const shell={get snapshot(){return {draftRev:state.rev}},insertReference(ref,span,push){if(span.draftRev!==state.rev)return false;rows.push({ref,span,push});state.rev++;return true}}
 return {rows,life,state,shell,insert:createSessionReferenceInsertion({sessions,targetId:'target',shell,resolve})}
}
// Execute the actual InputBar drop callback, not a parallel test implementation.
const bar=readFileSync(root+'skeleton/InputBar.tsx','utf8')
const callback=strip(bar.slice(bar.indexOf('const onReferenceDrop ='),bar.indexOf('const onReferenceDragLeave =')))
function mountedDrop(o){
 const keyboard={editor:{}},inputActions={captureInsertion:()=>({start:2,end:2,draftRev:o.state.rev})}
 const messages=[],request={current:0},current={current:{sessionId:'target',keyboard,inputActions}}
 const env={isSessionReferenceDrag,readSessionReferenceDrag:null,referenceTransaction:new SessionReferenceDropTransaction(),referenceRequest:request,referenceCurrent:current,
 referenceAvailable:()=>true,inputActions,keyboard,sessionId:'target',insertSessionReference:o.insert,occurrence:'main',
 setReferenceHover(){},setReferencePending(){},showToast:text=>messages.push(text),t:key=>key,focusDraftEditor(){},revealSelection(){},cardRef:{current:null},document:{activeElement:null}}
 // Share the production payload parser too.
 return {async ready(){env.readSessionReferenceDrag=(await import('../src/session-reference-drag.mjs')).readSessionReferenceDrag;return new Function(...Object.keys(env),callback+';return onReferenceDrop')(...Object.values(env))},messages}
}

test('real Cordis optional namespace lookup avoids the nested hard-inject trap',async()=>{
 const ctx=new Context(),resolver={async candidates(id,query,signal){assert.equal(id,'target');assert.equal(query,'source');assert.ok(signal instanceof AbortSignal);return {ok:true,value:[{sessionId:'source',mention:'@[Native](dsh-session:InNvdXJjZSI)',label:'Native'}]}}}
 const provider=ctx.plugin({name:'native-remote-services',apply(scope){new Service(scope,'remote');scope.provide('remote.sessionReferenceResolver',resolver)}})
 await provider
 let o,drop,legacyFailed=false
 const consumer=ctx.plugin({name:'conversation-without-optional-hard-inject',async apply(scope){
  assert.throws(()=>scope.get('remote').sessionReferenceResolver,/without inject/);legacyFailed=true
  assert.equal(resolveFor(scope),resolver)
  o=target(()=>resolveFor(scope));drop=mountedDrop(o)
  const handler=await drop.ready(),zone=new SessionReferenceDropZone()
  zone.register({sessionId:'target',over(){},drop:handler,leave(){},cancel(){}})
  const e=event();zone.route('drop',e,'target',true)
  await flush()
  assert.equal(e.defaultPrevented,true);assert.equal(e.dataTransfer.dropEffect,'copy')
  assert.equal(o.rows.length,1);assert.equal(o.rows[0].ref.appearance,'session');assert.equal(o.rows[0].push,true)
  assert.deepEqual(drop.messages,[]);assert.deepEqual(o.life,{retains:1,releases:1})
 }})
 try{await consumer;assert.equal(legacyFailed,true);assert.equal(o.rows.length,1)}finally{await consumer.dispose();await provider.dispose()}
})

test('area router forwards message-body and input-area drops once and ignores files/plain text',()=>{
 const feedback=[],zone=new SessionReferenceDropZone(value=>feedback.push(value)),calls=[]
 zone.register({sessionId:'target',over(e){e.preventDefault();e.stopPropagation();e.dataTransfer.dropEffect='copy'},drop(e){calls.push(e.target);e.preventDefault();e.stopPropagation()},leave(){},cancel(){}})
 for(const region of ['message','composer']){const e=event();e.target.region=region;zone.route('over',e,'target',true);assert.equal(feedback.at(-1),true);zone.route('drop',e,'target',true);assert.equal(feedback.at(-1),false);assert.equal(e.stopped,true)}
 assert.equal(calls.length,2)
 for(const t of [new Transfer(),Object.assign(transfer(),{extra:['Files']})]){const e=event(t);zone.route('drop',e,'target',true);assert.equal(e.defaultPrevented,false)}
 assert.equal(calls.length,2)
})

test('main identity, embedded nesting and owner cleanup prevent cross-session or duplicate delivery',()=>{
 const feedback=[],zone=new SessionReferenceDropZone(value=>feedback.push(value));let drops=0,cancels=0
 const unmount=zone.register({sessionId:'target',over(e){e.dataTransfer.dropEffect='copy'},drop(){drops++},leave(){},cancel(){cancels++}})
 for(const [id,main]of [['other',true],['target',false],[undefined,true]]){const e=event();zone.route('drop',e,id,main);assert.equal(e.dataTransfer.dropEffect,'none');assert.equal(e.defaultPrevented,true)}
 zone.route('over',event(),'target',true);assert.equal(feedback.at(-1),true)
 const nested=event();nested.target.closest=()=>({});zone.route('drop',nested,'target',true);assert.equal(nested.defaultPrevented,false);assert.equal(feedback.at(-1),false)
 unmount();const e=event();zone.route('drop',e,'target',true);assert.equal(e.defaultPrevented,true)
 assert.equal(drops,0);assert.equal(cancels,1);assert.equal(feedback.at(-1),false)
})

test('actual composer callback still refuses a real edit during candidate resolution',async()=>{
 let settle;const pending=new Promise(resolve=>{settle=resolve}),o=target(()=>({candidates:()=>pending})),drop=mountedDrop(o),handler=await drop.ready()
 handler(event());o.state.rev++
 settle({ok:true,value:[{sessionId:'source',mention:'@[Native](dsh-session:InNvdXJjZSI)',label:'Native'}]});await flush()
 assert.deepEqual(o.rows,[]);assert.deepEqual(drop.messages,['reference.failed']);assert.equal(o.life.retains,o.life.releases)
})

test('registration depends on target lifetime rather than fresh hover closures; area provider owns capture',()=>{
 assert.match(bar,/referenceHandlers\.current = \{ over: onReferenceDragOver, drop: onReferenceDrop, leave: onReferenceDragLeave \}/)
 assert.match(bar,/\[referenceZone, sessionId, keyboard, occurrence, referenceTransaction\]/)
 const content=readFileSync(root+'skeleton/ConversationContent.tsx','utf8')
 assert.match(content,/<SessionReferenceDropContext\.Provider value=\{referenceZone\}>/)
 for(const kind of ['over','drop','leave'])assert.ok(content.includes("referenceZone.route('"+kind+"', event, sessionId, props.variant === 'main')"))
 assert.doesNotMatch(content,/document\.addEventListener\('(?:dragover|drop)'/)
})
