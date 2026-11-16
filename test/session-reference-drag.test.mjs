import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {stripTypeScriptTypes} from 'node:module'
import {SESSION_REFERENCE_MIME, isSessionReferenceDrag, readSessionReferenceDrag, writeSessionReferenceDrag, matchesSessionReferenceMove} from '../src/session-reference-drag.mjs'
const conversation='.srcbuild/packages/client/ui-conversation/src/client/'
const workspace='.srcbuild/packages/client/ui-workspace/src/client/'
const strip=s=>stripTypeScriptTypes(s,{mode:'transform'}).replace(/^export /gm,'').replace(/^export\s*\{\s*\};?\s*$/gm,'')
const {createSessionReferenceInsertion,SessionReferenceDropTransaction}=new Function(strip(readFileSync(conversation+'input/session-reference-drop.ts','utf8'))+';return {createSessionReferenceInsertion,SessionReferenceDropTransaction}')()
const defer=()=>{let resolve;const promise=new Promise(r=>{resolve=r});return{promise,resolve}}
class Transfer {
  constructor(){this.data=new Map();this.effectAllowed='none';this.extra=[]}
  get types(){return [...this.data.keys(),...this.extra]}
  setData(k,v){this.data.set(k,v)}
  getData(k){return this.data.get(k)??''}
}
const transfer=(id='source',move=true)=>{const value=new Transfer();writeSessionReferenceDrag(value,id,move);return value}
function target({resolve,provided=true}={}){
  const rows=[],life={retains:0,releases:0},binding={session:{getSnapshot:()=>({openState:'open'})}},state={binding,current:true,rev:7,editable:true}
  const sessions={binding:()=>state.binding,async using(id,options,run){life.retains++;try{return await run({binding})}finally{life.releases++}}}
  const shell={get snapshot(){return{draftRev:state.rev}},insertReference(ref,span,push){if(!state.editable||span.draftRev!==state.rev)return false;rows.push({ref,span,push});state.rev++;return true}}
  const resolver={async candidates(id,query,signal){return resolve?resolve(id,query,signal):{ok:true,value:[{sessionId:'other',mention:'@[Other](dsh-session:eA)',label:'Other'},{sessionId:query,mention:'@[Native](dsh-session:InNvdXJjZSI)',label:'Native'}]}}}
  const insert=createSessionReferenceInsertion({sessions,targetId:'target',shell,resolve:()=>provided?resolver:undefined})
  const span={start:1,end:2,draftRev:7}
  return {rows,life,state,shell,insert,span,current:()=>state.current&&state.editable}
}

test('transport is ID-only, bounded, versioned and shared byte-for-byte by both forks',()=>{
  const value=transfer();assert.deepEqual(readSessionReferenceDrag(value),{version:1,sessionId:'source'});assert.equal(value.effectAllowed,'copyMove')
  assert.equal(transfer('readonly',false).effectAllowed,'copy')
  const canonical=readFileSync('src/session-reference-drag.mjs','utf8')
  assert.equal(readFileSync(workspace+'session-reference-drag.mjs','utf8'),canonical)
  assert.equal(readFileSync(conversation+'input/session-reference-drag.mjs','utf8'),canonical)
  for(const raw of ['bad','[]','null','{"version":2,"sessionId":"s"}','{"version":1,"sessionId":"s","title":"forged"}','{"version":1,"sessionId":""}',JSON.stringify({version:1,sessionId:'s'.repeat(9000)})]){value.setData(SESSION_REFERENCE_MIME,raw);assert.equal(readSessionReferenceDrag(value),null)}
})
test('Files and ordinary text remain outside the reference handler',()=>{
  const file=transfer();file.extra.push('Files');assert.equal(isSessionReferenceDrag(file),false)
  const text=new Transfer();text.setData('text/plain','source');assert.equal(isSessionReferenceDrag(text),false)
  assert.equal(matchesSessionReferenceMove(transfer(),'wrong',true),false)
  assert.equal(matchesSessionReferenceMove(transfer(),'source',false),false)
})
test('owner resolves the exact native candidate and inserts a chip with an explicit history boundary',async()=>{
  const o=target(),tx=new SessionReferenceDropTransaction()
  assert.equal(await tx.insert(o.insert,'source',o.span,o.current),'inserted')
  assert.deepEqual(o.rows,[{ref:{source:'reference',ref:'@[Native](dsh-session:InNvdXJjZSI)',label:'Native',appearance:'session',clipboardText:'@[Native](dsh-session:InNvdXJjZSI)'},span:o.span,push:true}])
  assert.deepEqual(o.life,{retains:1,releases:1})
})
test('self, absent resolver and non-exact candidates never mutate the draft',async()=>{
  for(const setup of [{provided:false},{resolve:async()=>({ok:true,value:[{sessionId:'prefix-source',mention:'@[Other](dsh-session:eA)',label:'Other'}]})}]){
    const o=target(setup);assert.equal(await new SessionReferenceDropTransaction().insert(o.insert,'source',o.span,o.current),'rejected');assert.equal(o.rows.length,0);assert.equal(o.life.retains,o.life.releases)
  }
  const o=target();assert.equal(await o.insert('target',o.span,new AbortController().signal,o.current),false);assert.equal(o.life.retains,0)
})
test('an intervening draft edit or Session binding generation change refuses a late response',async()=>{
  for(const mutation of [o=>o.state.rev++,o=>{o.state.binding={}},o=>{o.state.editable=false}]){
    const wait=defer(),o=target({resolve:()=>wait.promise}),p=new SessionReferenceDropTransaction().insert(o.insert,'source',o.span,o.current)
    mutation(o);wait.resolve({ok:true,value:[{sessionId:'source',mention:'@[Source](dsh-session:eA)',label:'Source'}]});await p
    assert.equal(o.rows.length,0);assert.equal(o.life.retains,o.life.releases)
  }
})
test('unmount or switching away and back cancels a stale generation even with the same id',async()=>{
  const wait=defer(),o=target({resolve:()=>wait.promise}),tx=new SessionReferenceDropTransaction(),p=tx.insert(o.insert,'source',o.span,o.current)
  tx.cancel();o.state.current=false;o.state.current=true
  wait.resolve({ok:true,value:[{sessionId:'source',mention:'@[Source](dsh-session:eA)',label:'Source'}]})
  assert.equal(await p,'stale');assert.equal(o.rows.length,0);assert.equal(o.life.retains,o.life.releases)
})
test('a newer drop wins and a rejected request releases its target retain',async()=>{
  const first=defer(),second=defer(),o=target({resolve:(_,id)=>id==='first'?first.promise:second.promise}),tx=new SessionReferenceDropTransaction()
  const a=tx.insert(o.insert,'first',o.span,o.current),b=tx.insert(o.insert,'second',o.span,o.current)
  second.resolve({ok:true,value:[{sessionId:'second',mention:'@[Second](dsh-session:eA)',label:'Second'}]});assert.equal(await b,'inserted')
  first.resolve({ok:true,value:[{sessionId:'first',mention:'@[First](dsh-session:eA)',label:'First'}]});assert.equal(await a,'stale')
  assert.equal(o.rows.length,1);assert.equal(o.rows[0].ref.label,'Second');assert.equal(o.life.retains,o.life.releases)
  const rejected=target({resolve:async()=>{throw Error('network')}});assert.equal(await new SessionReferenceDropTransaction().insert(rejected.insert,'source',rejected.span,rejected.current),'rejected');assert.equal(rejected.life.retains,rejected.life.releases)
})
test('actual shell guard rejects disposal, locked phases and stale revisions before touching its editor',()=>{
  const source=readFileSync(conversation+'input/facade.ts','utf8')
  const method=source.match(/  insertReference\(ref: ReferenceInsert, span: TokenSpan, historyBoundary = false\): boolean \{[\s\S]*?\n  \}/)?.[0];assert.ok(method)
  const Guard=new Function(strip('class Guard {\n'+method+'\n}')+';return Guard')(),calls=[]
  const shell={disposed:false,core:{state:{phase:'plain'}},rev:7,projection:{detectText:'abc'},draftEditor:{insertReference(...args){calls.push(args);return true}}}
  const ref={source:'reference',ref:'native',label:'Source'},span={start:0,end:1,draftRev:7}
  assert.equal(Guard.prototype.insertReference.call(shell,ref,span,true),true);assert.equal(calls[0][3],true)
  for(const update of [()=>{shell.disposed=true},()=>{shell.disposed=false;shell.core.state.phase='submitting'},()=>{shell.core.state.phase='plain';shell.rev=8}]){update();assert.equal(Guard.prototype.insertReference.call(shell,ref,span,true),false)}
  assert.equal(calls.length,1)
})
test('actual editor insertion keeps the native chip/separator and pushes one history boundary',()=>{
  const source=readFileSync(conversation+'input/editor/runtime.ts','utf8'),method=source.match(/  insertReference\(span: DetectSpan, ref: ReferenceInsert, tail: string, historyBoundary = false\): boolean \{[\s\S]*?\n  \}/)?.[0];assert.ok(method)
  let nodes,tag
  const Guard=new Function('$createReferenceChipNode','$createTextNode','$replaceDetectSpanWithNodes','HISTORY_PUSH_TAG',strip('class Guard {\n'+method+'\n}')+';return Guard')(ref=>({chip:ref}),text=>({text}),(span,value)=>{nodes=value;return true},'history-push')
  const runtime={applyEdit(run,boundary){tag=boundary;run()}},ref={source:'reference',ref:'native',label:'Source'}
  assert.equal(Guard.prototype.insertReference.call(runtime,{start:1,end:1},ref,'x',true),true);assert.deepEqual(nodes,[{chip:ref},{text:' '}]);assert.equal(tag,'history-push')
  Guard.prototype.insertReference.call(runtime,{start:1,end:1},ref,' ',true);assert.equal(nodes.length,1)
})
test('grouped and flat Session dragend callbacks only clear and never commit a hovered marker',()=>{
  const source=readFileSync(workspace+'rows/WorkspaceBrowser.tsx','utf8')
  const grouped=source.slice(source.indexOf('const dragProps = {')),flat=source.slice(source.indexOf('sourceId: drag?.sessionId',source.indexOf('function Flat')))
  for(const code of [grouped,flat]){
    const body=code.match(/end: \(\) => \{([\s\S]*?)\n\s*\},/)?.[1];assert.ok(body)
    const clears=[],sessionDropCommitted={current:true},dropCommitted={current:true}
    new Function('setDrag','sessionDropCommitted','dropCommitted',body)(value=>clears.push(value),sessionDropCommitted,dropCommitted)
    assert.deepEqual(clears,[null])
  }
})
test('actual row drop accepts only the active matching source with current move permission',()=>{
  const source=readFileSync(workspace+'rows/Rows.tsx','utf8'),body=source.match(/\(e\) => \{\n\s*if \(!drag.active \|\| !matchesSessionReferenceMove([\s\S]*?)drag.drop\(rowHalf\(e\)\)\n\s*\}/)?.[0];assert.ok(body)
  const run=new Function('drag','reorderable','matchesSessionReferenceMove','rowHalf','return '+body)
  for(const [payload,active,permitted,count] of [[transfer(),true,true,1],[transfer('foreign'),true,true,0],[transfer(),false,true,0],[transfer(),true,false,0]]){
    let moved=0;const handler=run({active,sourceId:'source',drop:()=>moved++},permitted,matchesSessionReferenceMove,()=> 'before')
    handler({dataTransfer:payload,preventDefault(){},stopPropagation(){}});assert.equal(moved,count)
  }
})
test('task move guard rejects copy-only state, pending moves, removed membership and foreign payload',()=>{
  const source=readFileSync('src/client.js','utf8'),expression=source.match(/const canCommitTaskDrop = ([\s\S]*?)\n  const commitDrop/)?.[1];assert.ok(expression)
  const create=new Function('drag','taskIds','pendingMoves','taskPins','matchesSessionReferenceMove','return ('+expression+')')
  for(const [drag,ids,pending,writable,payload,expected] of [[{sessionId:'source'},['source'],[],true,transfer(),true],[null,['source'],[],true,transfer(),false],[{sessionId:'source'},[],[],true,transfer(),false],[{sessionId:'source'},['source'],['source'],true,transfer(),false],[{sessionId:'source'},['source'],[],false,transfer(),false],[{sessionId:'source'},['source'],[],true,transfer('foreign'),false]])assert.equal(create(drag,ids,new Set(pending),{writable},matchesSessionReferenceMove)({dataTransfer:payload}),expected)
})
