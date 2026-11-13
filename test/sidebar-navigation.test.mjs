import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import { createPanelLauncherPins, SidebarPanelIcon, SIDEBAR_LAYOUT } from '../src/client.js'
import { createSidebarChildDeclarations } from '../src/task-model.mjs'
import { DEFAULT_TASK_PREFERENCES } from '../src/task-preferences.mjs'

const source = readFileSync(new URL('../src/client.js',import.meta.url),'utf8')
const rootSource = source.slice(source.indexOf('export function BetterSidebarRoot('),source.indexOf('function TaskSettingsSection(')).replace(/^export /gm,'')
const navigationSource = source.slice(source.indexOf('export function PanelRow('),source.indexOf('export function SidebarRootGuard(')).replace(/^export /gm,'')
const element = (type,props,...children) => ({type,props:props??{},children:children.flat()})
const nodes = node => node && typeof node==='object' ? [node,...node.children.flatMap(nodes),...nodes(node.props.children)] : []
function harness(overrides={}) {
  const calls=[],states=[],slots=[]
  const primitives={Tooltip:'Tooltip',Menu:'Menu',IconNewChatOutlineMedium:'NewMedium',IconNewChatOutlineRegular:'NewRegular',IconAppsAddOutlineRegular:'MoreIcon',IconPinFillRegular:'Pin',ShortcutKeys:'ShortcutKeys'}
  const context={element,SIDEBAR_LAYOUT,requireModule:name=>name==='react'?{
    createElement:element,useState:initial=>[initial,value=>states.push(typeof value==='function'?value(initial):value)],useEffect:()=>{},useRef:value=>({current:value}),
  }:primitives,
    IconPanelLeftOutlineRegular:'PanelLeft',PanelRow:'PanelRow',PanelMoreMenu:'PanelMoreMenu',SidebarRegion:'SidebarRegion',TASK_GRID_TWO_COLUMN_THRESHOLD:528,
    window:{setTimeout:()=>1,clearTimeout:()=>{}},
  }
  const props={collapsed:false,width:420,startSession:()=>calls.push(['new']),toggleSidebar:()=>{},selectPanel:id=>calls.push(['open',id]),
    usePanels:read=>read([{id:'plugins',label:'Plugins'},{id:'automation',label:'Automations'},{id:'custom',label:'Custom'}]),
    useEntryPins:read=>read(['automation']),useEntryActions:read=>read(true),usePanelInfo:read=>read({activePanelId:'custom'}),
    useTaskPreferences:read=>read({value:DEFAULT_TASK_PREFERENCES}),
    useShortcuts:read=>read([{id:'session.new',aria:'Control+N',keys:['Ctrl','N']}]),useRemoteAccess:permission=>{assert.equal(permission,'session/create');return true},
    nativePanelIcons:true,setPanelPinned:(...args)=>calls.push(['pin',...args]),t:key=>key,
    renderSlot:(...args)=>{slots.push(args);return args[0]==='sidebar.session.action'?args[2].children:element('Slot',{})},...overrides,
  }
  const Root=vm.runInNewContext(rootSource+'\nBetterSidebarRoot',context)
  const components=vm.runInNewContext(navigationSource+'\n({PanelRow,PanelMoreMenu})',context)
  return {tree:Root(props),render:next=>Root({...props,...next}),props,calls,states,slots,context,...components}
}

test('panel launcher choices have native transient lifetime and never mutate fixed Plugins',()=>{
  const pins=createPanelLauncherPins(),other=createPanelLauncherPins();let events=0
  pins.source.subscribe(()=>events++)
  pins.setPinned('custom',false);const changed=pins.source.getSnapshot()
  pins.setPinned('custom',false);pins.setPinned('plugins',false);pins.setPinned('x','false');pins.setPinned('',false)
  assert.equal(pins.source.getSnapshot(),changed);assert.equal(events,1)
  assert.deepEqual(other.source.getSnapshot(),[])
  pins.setPinned('custom',true);assert.deepEqual(pins.source.getSnapshot(),[])
})
test('native icon factory is the sole owner on rc.2 and forwards plugin-owned icon identity',()=>{
  assert.equal(createSidebarChildDeclarations({iconsInFactory:true})['sidebar.panellist'],undefined)
  assert.deepEqual(createSidebarChildDeclarations()['sidebar.panellist.actions'],{kind:'list',scope:'root'})
  const calls=[];SidebarPanelIcon({id:'custom',size:18,active:true,renderSlot:(...args)=>calls.push(args)})
  assert.deepEqual(calls,[['sidebar.panellist',{size:18,active:true},{only:'custom'}]])
})
test('expanded navigation contains pinned launchers plus More, not hard-coded panel names or text labels',()=>{
  const f=harness(),all=nodes(f.tree),rows=all.filter(n=>n.type===f.PanelRow)
  assert.deepEqual(rows.map(n=>n.props.panel.id),['plugins','custom'])
  const more=all.find(n=>n.type===f.PanelMoreMenu)
  assert.equal(more.props.label,'panels.more')
  assert.equal(JSON.stringify(more.props.entries),JSON.stringify([
    {id:'automation',label:'Automations',pinned:false,active:false},{id:'custom',label:'Custom',pinned:true,active:true},
  ]))
  assert.equal(more.props.onPinnedChange,f.props.setPanelPinned)
  assert.equal(all.some(n=>n.props.className==='dbt-panel-label'),false)
})
test('missing/unmounted customization provider reveals all launchers and offers no dead More menu',()=>{
  const f=harness({useEntryActions:read=>read(false)})
  assert.deepEqual(nodes(f.tree).filter(n=>n.type===f.PanelRow).map(n=>n.props.panel.id),['plugins','automation','custom'])
  assert.equal(nodes(f.tree).some(n=>n.type===f.PanelMoreMenu),false)
})
test('provider loss and return in one lifetime preserve launcher choices without losing reachability',()=>{
  const pins=createPanelLauncherPins();pins.setPinned('automation',false)
  const choice=pins.source.getSnapshot();let present=true
  const f=harness({useEntryPins:read=>read(pins.source.getSnapshot()),useEntryActions:read=>read(present)})
  const ids=tree=>nodes(tree).filter(n=>n.type===f.PanelRow).map(n=>n.props.panel.id)
  assert.deepEqual(ids(f.tree),['plugins','custom'])
  present=false;const degraded=f.render({})
  assert.deepEqual(ids(degraded),['plugins','automation','custom'])
  assert.equal(nodes(degraded).some(n=>n.type===f.PanelMoreMenu),false)
  assert.equal(nodes(degraded).some(n=>n.props.canUnpin),false)
  present=true;assert.deepEqual(ids(f.render({})),['plugins','custom'])
  assert.equal(pins.source.getSnapshot(),choice);assert.deepEqual(f.calls,[])
})

test('new-session uses official glyph, shortcut hint, tooltip and shared action',()=>{
  const f=harness(),all=nodes(f.tree),button=all.find(n=>n.props.className==='dbt-new-session')
  assert.equal(button.props['aria-keyshortcuts'],'Control+N')
  assert.ok(nodes(button).some(n=>n.type==='NewMedium'&&n.props.size===14))
  assert.ok(nodes(button).some(n=>n.type==='ShortcutKeys'))
  assert.ok(nodes(button).some(n=>n.props.className==='dbt-new-label-mask'))
  assert.equal(nodes(button).some(n=>n.children.includes('＋')),false)
  assert.equal(all.find(n=>n.type==='Tooltip'&&n.props.label==='session.new.label').props.disabled,true)
  button.props.onClick();assert.deepEqual(f.calls,[['new']])
})
test('denied native session-create capability removes both New Session affordances',()=>{
  const f=harness({useRemoteAccess:()=>false})
  assert.equal(nodes(f.tree).some(n=>n.props['aria-label']==='session.new.label'),false)
  assert.equal(nodes(f.tree).some(n=>n.props.className==='dbt-new-session'),false)
})
test('rc.3 declares the New Session action as root HOC without sharing the icon-factory child',()=>{
  for(const iconsInFactory of [false,true]) {
    const children=createSidebarChildDeclarations({iconsInFactory})
    assert.deepEqual(children['sidebar.session.action'],{kind:'hoc',scope:'root'})
    assert.equal(children['sidebar.panellist']?.kind,iconsInFactory?undefined:'list')
  }
})
test('rc.3 no-occupant HOC preserves the native New Session content as options.children',()=>{
  const f=harness(),[name,owner,opts]=f.slots.find(([key])=>key==='sidebar.session.action')
  assert.equal(name,'sidebar.session.action')
  assert.equal(JSON.stringify(owner),JSON.stringify({wide:true}))
  assert.deepEqual(Object.keys(opts),['children'])
  assert.equal(opts.children.type,'Tooltip')
  const row=nodes(f.tree).find(n=>n.props.className==='dbt-new-session-row')
  assert.equal(row.children[0],opts.children)
  assert.equal(nodes(row).filter(n=>n.props.className==='dbt-new-session').length,1)
  assert.deepEqual(f.calls,[],'rendering an optional action cannot create a Session')
})
test('rc.3 action layers retain the native button exactly once and receive narrow/wide state',()=>{
  for(const collapsed of [false,true]) {
    const calls=[],slots=[]
    const f=harness({collapsed,startSession:()=>calls.push('new'),renderSlot:(name,owner,opts)=>{
      if(name!=='sidebar.session.action')return null
      slots.push([owner,opts])
      return element('HocLayer',{},opts.children,element('button',{'data-import-action':true}))
    }})
    const all=nodes(f.tree),button=all.find(n=>n.props.className==='dbt-new-session')
    assert.equal(slots.length,1)
    assert.equal(slots[0][0].wide,!collapsed)
    assert.equal(all.filter(n=>n.props['data-import-action']).length,1)
    assert.equal(all.filter(n=>n.props.className==='dbt-new-session').length,1)
    button.props.onClick();assert.deepEqual(calls,['new'])
  }
})
test('rc.3 denied Session creation never renders or invokes the optional action HOC',()=>{
  const f=harness({useRemoteAccess:()=>false})
  assert.equal(f.slots.some(([name])=>name==='sidebar.session.action'),false)
  assert.equal(nodes(f.tree).some(n=>n.props.className==='dbt-new-session-row'),false)
})
test('rc.3 row layout leaves sibling actions outside the flexing native button',()=>{
  assert.match(source,/\.dbt-new-session-row\{[^}]*display:flex;[^}]*gap:6px/)
  assert.match(source,/\.dbt-new-session\{[^}]*flex:1 1 auto;min-width:0/)
  assert.match(source,/\.dbt-sidebar\[data-wide="false"\] \.dbt-new-session-row\{[^}]*flex-direction:column/)
  assert.doesNotMatch(rootSource,/deepseekChatImport|importArchive/)
})

test('icon-only row has hover label, active state and native factory selection',()=>{
  const f=harness(),factories=[]
  const tree=f.PanelRow({panel:{id:'custom',label:'Custom'},usePanelInfo:f.props.usePanelInfo,selectPanel:f.props.selectPanel,renderFactorySlot:(...args)=>{factories.push(args);return null}})
  assert.equal(tree.type,'div')
  const tooltip=nodes(tree).find(n=>n.type==='Tooltip')
  assert.equal(tooltip.props.label,'Custom');assert.equal(tooltip.props.delayMs,SIDEBAR_LAYOUT.tooltipDelayMs)
  const button=nodes(tree).find(n=>n.type==='button')
  assert.equal(button.props['aria-current'],'page');assert.equal(button.props['aria-label'],'Custom')
  button.props.onClick();assert.deepEqual(f.calls,[['open','custom']])
  assert.equal(JSON.stringify(factories),JSON.stringify([['sidebar.panel.icon',{id:'custom',size:18,active:true}]]))
})
test('compact unpin hands focus to More before removing a launcher',()=>{
  const f=harness(),more={focus:()=>f.calls.push(['focus-more'])}
  const tree=f.PanelRow({panel:{id:'custom',label:'Custom'},usePanelInfo:f.props.usePanelInfo,selectPanel:f.props.selectPanel,
    renderFactorySlot:()=>null,canUnpin:true,unpinLabel:'Unpin Custom',setPanelPinned:f.props.setPanelPinned})
  const button=nodes(tree).find(n=>n.props.className==='dbt-panel-unpin')
  assert.equal(button.props['aria-label'],'Unpin Custom')
  button.props.onClick({currentTarget:{closest:()=>({querySelector:()=>more})}})
  assert.deepEqual(f.calls,[['focus-more'],['pin','custom',false]])
  const row=nodes(f.tree).find(n=>n.type===f.PanelRow&&n.props.panel.id==='plugins')
  assert.equal(row.props.canUnpin,false)
  const custom=nodes(f.tree).find(n=>n.type===f.PanelRow&&n.props.panel.id==='custom')
  assert.equal(custom.props.canUnpin,true)
})
test('many dynamic entries are retained; bounded wrapping/scrolling never changes pin membership',()=>{
  const panels=Array.from({length:50},(_,i)=>({id:'extension-'+i,label:'Extension '+i}))
  const f=harness({usePanels:read=>read(panels),useEntryPins:read=>read([])})
  assert.equal(nodes(f.tree).filter(n=>n.type===f.PanelRow).length,50)
  assert.equal(nodes(f.tree).find(n=>n.type===f.PanelMoreMenu).props.entries.length,50)
  assert.deepEqual(f.calls,[])
  assert.equal(Object.isFrozen(SIDEBAR_LAYOUT),true)
  assert.equal(SIDEBAR_LAYOUT.maxNavigationRows,2)
  const rule=source.match(/(?:^|\n)\.dbt-panel-list\{([^}]+)\}/)[1]
  assert.match(rule,/max-height:calc\(var\(--dbt-nav-target\)\*var\(--dbt-nav-rows\)/)
  assert.match(rule,/overflow-y:auto/)
  assert.match(source,/--dbt-nav-target:\$\{SIDEBAR_LAYOUT\.iconTarget\}px/)
})

test('legacy icon path still renders registered icons instead of inventing glyphs',()=>{
  const f=harness(),calls=[]
  f.PanelRow({panel:{id:'custom',label:'Custom'},usePanelInfo:f.props.usePanelInfo,selectPanel:()=>{},renderSlot:(...args)=>calls.push(args)})
  assert.equal(JSON.stringify(calls),JSON.stringify([['sidebar.panellist',{size:18,active:true},{only:'custom'}]]))
})
test('More delegates rows and pin/open/dismiss actions to the official extension slot',()=>{
  const f=harness(),entries=[{id:'custom',label:'Custom',pinned:true,active:true}]
  const tree=f.PanelMoreMenu({entries,label:'More',onOpen:f.props.selectPanel,onPinnedChange:f.props.setPanelPinned,renderSlot:f.props.renderSlot})
  assert.equal(tree.type,'Menu');assert.equal(tree.props.portal,true);assert.equal(tree.props.autoFocus,true)
  const button=nodes(tree.props.anchor).find(n=>n.type==='button')
  assert.equal(button.props['aria-haspopup'],'menu');assert.equal(button.props['aria-expanded'],false)
  button.props.onClick();assert.deepEqual(f.states,[true])
  const [seat,owner]=f.slots.find(([name])=>name==='sidebar.panellist.actions')
  assert.equal(seat,'sidebar.panellist.actions');assert.equal(owner.entries,entries)
  owner.onOpen('custom');owner.onPinnedChange('custom',true);owner.onDismiss();tree.props.onClose()
  assert.deepEqual(f.calls,[['open','custom'],['pin','custom',true]])
  assert.deepEqual(f.states,[true,false,false])
})
test('new-session copies native elevated control tokens and navigation stays compact by source contract',()=>{
  const newStyle=source.match(/(?:^|\n)\.dbt-new-session\{([^}]+)\}/)[1]
  assert.match(newStyle,/height:var\(--dbt-new-height\)/);assert.match(newStyle,/border-radius:var\(--dsw-radius-md\)/)
  assert.match(newStyle,/background:var\(--dsw-alias-button-elevated-fill\)/)
  assert.match(newStyle,/color:var\(--dsw-alias-label-primary\)/)
  assert.doesNotMatch(newStyle,/brand-primary|static-white/)
  assert.match(source,/\.dbt-panel-list\{[^}]*flex-direction:row;flex-wrap:wrap/)
})
