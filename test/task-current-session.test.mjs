import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {currentTaskSessionId,derivePinnedTasks} from '../src/task-model.mjs'
const row=(id,retainedBy={},extra={})=>({id,retainedBy,blank:false,running:false,updatedAt:1,...extra})
const list=rows=>({ids:rows.map(x=>x.id),byId:Object.fromEntries(rows.map(x=>[x.id,x]))})
const selected=(snapshot,panelActive=false)=>derivePinnedTasks({list:snapshot,pinnedSessionIds:snapshot.ids,panelActive}).filter(x=>x.current).map(x=>x.id)
test('0.2 main-view retention selects the open idle session, not a background running session',()=>{
 const snapshot=list([row('background',{}, {running:true}),row('open',{mainView:1})])
 assert.deepEqual(selected(snapshot),['open'])
})
test('main-view session switch transfers current state without local click memory',()=>{
 const first=list([row('a',{mainView:1}),row('b',{})])
 const second=list([row('a',{}),row('b',{mainView:1})])
 assert.deepEqual(selected(first),['a']);assert.deepEqual(selected(second),['b'])
})
test('non-conversation panel clears selection without releasing the underlying session',()=>{
 const snapshot=list([row('open',{mainView:1})])
 assert.deepEqual(selected(snapshot,true),[]);assert.deepEqual(selected(snapshot,false),['open'])
})
test('sidebar/background references and zero main-view references are not current',()=>{
 assert.deepEqual(selected(list([row('side',{sidebar:1}),row('zero',{mainView:0}),row('worker',{agent:1},{running:true})])),[])
})
test('0.2 retention contract wins over a stale legacy current field, including no main view',()=>{
 assert.equal(currentTaskSessionId({...list([row('a',{}),row('b',{mainView:2})]),current:'a'}),'b')
 assert.equal(currentTaskSessionId({...list([row('a',{})]),current:'a'}),undefined)
})
test('legacy list.current and empty lists remain compatible',()=>{
 const legacy={ids:['old'],byId:{old:{id:'old',blank:false,running:false}},current:'old'}
 assert.deepEqual(selected(legacy),['old']);assert.deepEqual(selected(legacy,true),[])
 assert.deepEqual(selected(list([])),[])
})
test('sidebar threads the standard panel hook to the swimlane and uses derived selection CSS unchanged',()=>{
 const source=readFileSync(new URL('../src/client.js',import.meta.url),'utf8')
 assert.match(source,/function TaskSwimlane\(\{[^}]*\busePanelInfo\b/)
 assert.match(source,/function SidebarRegion\(\{[^}]*\busePanelInfo\b/)
 assert.match(source,/element\(SidebarRegion, \{[^}]*\busePanelInfo\b/)
 assert.match(source,/element\(TaskSwimlane, \{[^}]*\busePanelInfo\b/)
 assert.match(source,/const panelActive = usePanelInfo\(\(info\) => info\.activePanelId !== null\)/)
 assert.match(source,/derivePinnedTasks\(\{\s*list,\s*panelActive,/)
 assert.match(source,/'data-current': String\(task\.current\)/)
 assert.match(source,/\.dbt-task-card\[data-current="true"\]\{border-color:var\(--dbt-task-border-selected\)/)
})
