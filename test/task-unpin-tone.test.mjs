import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const source=readFileSync(new URL('../src/client.js',import.meta.url),'utf8')
const rule=selector=>{
 const start=source.indexOf(selector+'{');assert.ok(start>=0,selector)
 return source.slice(start+selector.length+1,source.indexOf('}',start))
}
test('Unpin derives a quiet tint from the actual card background and its theme-aware tone',()=>{
 const base=rule('.dbt-task-card')
 assert.ok(base.includes('--dbt-task-tone:var(--dsw-alias-label-primary)'))
 assert.ok(base.includes('--dbt-task-bg:var(--dsw-alias-bg-layer-1)'))
 assert.ok(base.includes('background:var(--dbt-task-bg)'))
 assert.ok(base.includes('--dbt-unpin-color:color-mix(in srgb,var(--dbt-task-bg) 80%,var(--dbt-task-tone))'))
 assert.equal((source.match(/--dbt-unpin-color:/g)??[]).length,1,'no high-contrast state override')
})
test('state and selected-card backgrounds retain their exact previous tint expressions',()=>{
 for(const [state,tone,tint,selected] of [
  ['idle','var(--dsw-alias-label-primary)',3,8],
  ['running','var(--dsw-alias-success,#1f9d62)',12,17],
  ['block','var(--dbt-block-yellow)',18,23],
 ]){
  assert.ok(rule(`.dbt-task-card[data-state="${state}"]`).includes(`--dbt-task-bg:color-mix(in srgb,${tone} ${tint}%,var(--dsw-alias-bg-layer-1))`))
  const selector=state==='idle'?'.dbt-task-card[data-current="true"]':`.dbt-task-card[data-current="true"][data-state="${state}"]`
  assert.ok(rule(selector).includes(`--dbt-task-bg:color-mix(in srgb,${tone} ${selected}%,var(--dsw-alias-bg-layer-1))`))
 }
})
test('official icon, transparent hover treatment, focus reveal and disabled behavior remain intact',()=>{
 const button=rule('.dbt-task-unpin')
 assert.ok(button.includes('background:transparent;color:var(--dbt-unpin-color)'))
 assert.equal(rule('.dbt-task-unpin:hover'),'border-color:color-mix(in srgb,var(--dbt-unpin-color) 40%,transparent)')
 assert.ok(source.includes('.dbt-task-card:focus-within .dbt-task-unpin'))
 assert.equal(rule('.dbt-task-unpin:disabled'),'cursor:default;opacity:.45')
 assert.ok(source.includes('return element(IconPinFillRegular, { size })'))
})
