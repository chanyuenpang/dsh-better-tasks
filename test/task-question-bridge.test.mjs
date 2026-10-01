import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
const source=readFileSync(new URL('../src/client.js',import.meta.url),'utf8')
const fragment=source.slice(source.indexOf('function TaskQuestionCard('),source.indexOf('function TaskActionDialog('))
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve()}
function fixture(create){
 const states=[],effects=[],calls=[];let s=0,e=0,scheduled=[],dirty=false,tree
 let props={target:{sessionId:'task-a',requestKey:'request-a',callId:'call-a',kind:'question'},fontSize:13,t:key=>key,
  canRevealQuestion:()=>true,revealQuestion:(...args)=>{calls.push(['reveal',...args]);return true},
  createTaskQuestion:options=>{calls.push(['create',options]);return create(options)}}
 const React={useState(initial){const id=s++;if(!(id in states))states[id]=initial;return[states[id],next=>{const value=typeof next==='function'?next(states[id]):next;if(!Object.is(value,states[id])){states[id]=value;dirty=true}}]},
  useEffect(fn,deps){const id=e++,prior=effects[id];if(!prior||deps.some((value,index)=>!Object.is(value,prior.deps[index])))scheduled.push(()=>{prior?.off?.();effects[id]={deps,off:fn()}})},
  useSyncExternalStore:(_subscribe,get)=>get()}
 const {TaskQuestionCard}=vm.runInNewContext(fragment+';({TaskQuestionCard})',{AbortController,Promise,requireModule:()=>React,element:(type,props,...children)=>({type,props,children})})
 const render=patch=>{props={...props,...patch};let rounds=0;do{s=0;e=0;scheduled=[];dirty=false;tree=TaskQuestionCard(props);for(const run of scheduled)run();if(++rounds>12)throw Error('render loop')}while(dirty);return tree}
 const unmount=()=>effects.forEach(effect=>effect?.off?.())
 return{calls,render,unmount,get tree(){return tree}}
}
const handle=()=>({state:{subscribe:()=>()=>{},getSnapshot:()=>({phase:'ready'})},View:()=>null,closed:Promise.resolve(),disposed:0,dispose(){this.disposed++}})
test('question bridge acquires exact target once and font changes only update the bound View',async()=>{
 const h=handle(),f=fixture(async()=>h);f.render();await flush();f.render()
 assert.equal(f.calls.length,1);assert.equal(f.calls[0][1].sessionId,'task-a');assert.equal(f.calls[0][1].requestKey,'request-a');assert.equal(f.calls[0][1].callId,'call-a')
 const view=f.tree.type(f.tree.props);assert.equal(view.type,h.View);assert.equal(view.props.fontSize,13)
 f.render({fontSize:20});assert.equal(f.calls.length,1);assert.equal(f.tree.type(f.tree.props).props.fontSize,20)
 f.unmount();assert.equal(h.disposed,1);assert.equal(f.calls[0][1].signal.aborted,true)
})
test('aborted late acquisition disposes its handle without revealing another composer',async()=>{
 let resolve;const h=handle(),f=fixture(()=>new Promise(done=>{resolve=done}));f.render();await flush();f.unmount();resolve(h);await flush()
 assert.equal(h.disposed,1);assert.equal(f.calls.filter(x=>x[0]==='reveal').length,0)
})
test('new question identity retires old handle rather than reusing answers or a stale request',async()=>{
 const handles=[handle(),handle()];let index=0;const f=fixture(async()=>handles[index++])
 f.render();await flush();f.render();f.render({target:{sessionId:'task-a',requestKey:'request-b',callId:'call-b',kind:'question'}})
 await flush();f.render();assert.equal(handles[0].disposed,1);assert.equal(f.calls[1][1].callId,'call-b');f.unmount();assert.equal(handles[1].disposed,1)
})
test('closed views hide, while unsupported plan review is an explicit reveal fallback',async()=>{
 const h=handle();let phase='closed';h.state.getSnapshot=()=>({phase})
 const f=fixture(async()=>h);f.render();await flush();f.render();assert.equal(f.tree.type(f.tree.props),null)
 phase='unsupported';const button=f.tree.type(f.tree.props);assert.equal(button.type,'button');assert.equal(f.calls.filter(x=>x[0]==='reveal').length,0)
 button.props.onClick({stopPropagation(){}});assert.equal(f.calls.filter(x=>x[0]==='reveal').length,1);f.unmount()
})
test('main wrapper owns no question submission or draft implementation',()=>{
 assert.doesNotMatch(fragment,/remote\.|\.answer\(|\.delegate\(|\.dismiss\(|\.setDraft\(|openSession\(/)
 assert.match(source,/findTaskQuestion\?\.\(id\)/)
 assert.match(source,/target: questionTarget, createTaskQuestion, fontSize: preferences\.detailFontSize/)
})
