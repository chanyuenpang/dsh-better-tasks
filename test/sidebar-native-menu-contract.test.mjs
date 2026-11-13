import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import test from 'node:test'
import { createPanelLauncherPins, SidebarPanelIcon } from '../src/client.js'
import { createSidebarChildDeclarations } from '../src/task-model.mjs'

// Execute the actual pinned upstream menu and renderer authorization functions.
// Primitives are transport stand-ins; this is not a browser or appearance test.
const requireBuild=createRequire(new URL('../.srcbuild/package.json',import.meta.url))
const ts=requireBuild('typescript'),React=requireBuild('react'),{renderToStaticMarkup}=requireBuild('react-dom/server')
const jsxRuntime=requireBuild('react/jsx-runtime')
const fixture=name=>readFileSync(new URL('./fixtures/sidebar-rc2/'+name,import.meta.url),'utf8')
const provenance=JSON.parse(fixture('provenance.json'))
const records=provenance.files
for(const row of records)assert.equal(createHash('sha256').update(fixture(row.snapshot)).digest('hex'),row.snapshotSha256)
const icon=props=>React.createElement('svg',{'data-native-test-icon':true,...props})
const primitives={
  Button:({children,onClick,...props})=>React.createElement('button',{...props,onClick},children),
  MenuItemButton:({children,icon,onSelect,current,separatorBefore})=>React.createElement('button',{onClick:onSelect,'aria-current':current?'page':undefined},icon,children),
  Tooltip:({children})=>children,
  IconCheckOutlineRegular:icon,IconPinOutlineRegular:icon,IconPluginPinwheelOutlineRegular:icon,IconPlusOutlineRegular:icon,
}
function load(name,globals={}) {
  const output=ts.transpileModule(fixture(name),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText
  const exports={}
  const require=module=>{
    if(module==='react/jsx-runtime')return jsxRuntime
    if(module==='@deepseek-ai/dsh-client-ui-primitives')return primitives
    if(module==='./EntryMenu.module.css')return {default:new Proxy({},{get:(_,key)=>String(key)})}
    throw Error('unexpected native fixture import: '+module)
  }
  vm.runInNewContext(output,{exports,module:{exports},require,...globals},{filename:name})
  return exports
}
const native=load('EntryMenuContent.tsx')
class SlotOwnershipError extends Error {}
class StaleAuthorizationError extends Error {}
function bindings() {
  return load('scoped-slot-bindings.tsx',{SlotOwnershipError,StaleAuthorizationError,
    SlotOutlet:({slotKey,ownerProps})=>React.createElement('svg',{'data-native-slot':slotKey,'data-active':String(ownerProps.active)})})
}
const walk=node=>React.isValidElement(node)?[node,...React.Children.toArray(node.props.children).flatMap(walk)]:[]

test('real rc.2 renderer forbids root icon-seat access, permits factory, and rejects stale bindings',()=>{
  const {boundRenderSlot,boundFactoryRenderSlot}=bindings();let alive=true
  const host={isLive:()=>alive,isFactoryLive:()=>alive}
  const root={children:createSidebarChildDeclarations({iconsInFactory:true})}
  const factory={children:{'sidebar.panellist':{kind:'list',scope:'root'}}}
  const rootRender=boundRenderSlot(host,root),factoryRender=boundFactoryRenderSlot(host,factory)
  assert.throws(()=>rootRender('sidebar.panellist',{}),/not declared/)
  assert.equal(rootRender('sidebar.panellist.actions',{}).props.slotKey,'sidebar.panellist.actions')
  assert.equal(factoryRender('sidebar.panellist',{size:18,active:false}).props.slotKey,'sidebar.panellist')
  alive=false
  assert.throws(()=>rootRender('sidebar.panellist.actions',{}),/disposed registration/)
  assert.throws(()=>factoryRender('sidebar.panellist',{}),/disposed Factory/)
})
test('real rc.2 menu opens only hidden launchers, renders the authorized icon and repins through the sole owner',()=>{
  const pins=createPanelLauncherPins(),calls=[],registered=[{id:'custom',label:'Custom'}]
  const {boundFactoryRenderSlot}=bindings()
  const renderIcon=boundFactoryRenderSlot({isFactoryLive:()=>true},{children:{'sidebar.panellist':{kind:'list',scope:'root'}}})
  const render=()=>native.EntryMenuContent({
    entries:registered.map(panel=>({...panel,pinned:!pins.source.getSnapshot().includes(panel.id),active:true})),
    region:'sidebar',onOpen:id=>calls.push(['open',id]),onPinnedChange:pins.setPinned,
    onDismiss:()=>calls.push(['dismiss']),usePluginNavigation:select=>select(false),browsePlugins:()=>{},createPlugin:()=>{},
    t:(key,args)=>key+':'+(args?.name??''),
    renderFactorySlot:(name,owner)=>{assert.equal(name,'sidebar.panel.icon');return React.createElement(SidebarPanelIcon,{...owner,renderSlot:renderIcon})},
  })
  assert.equal(renderToStaticMarkup(render()).includes('Custom'),false,'official sidebar menu omits pinned launchers')
  pins.setPinned('custom',false)
  const hidden=pins.source.getSnapshot(),tree=render(),html=renderToStaticMarkup(tree)
  assert.match(html,/Custom/);assert.match(html,/data-native-slot="sidebar.panellist"/)
  const open=walk(tree).find(node=>node.type===primitives.MenuItemButton&&node.props.current===true)
  open.props.onSelect()
  assert.deepEqual(calls,[['dismiss'],['open','custom']]);assert.equal(pins.source.getSnapshot(),hidden)
  const pin=walk(tree).find(node=>node.type===primitives.Button&&node.props['aria-label']==='pin:Custom')
  assert.ok(pin);pin.props.onClick()
  assert.deepEqual(pins.source.getSnapshot(),[])
  assert.equal(renderToStaticMarkup(render()).includes('Custom'),false)
})
