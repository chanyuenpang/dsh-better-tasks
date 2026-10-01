// Fail closed if unrelated packages/composition changed while a candidate was being tested.
import {readFile,writeFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {createRequire} from 'node:module'
import assert from 'node:assert/strict'
const base=resolve(process.argv[2]),baseline=JSON.parse(await readFile(join(base,'baseline.json'),'utf8'))
const {parse}=createRequire(join(baseline.source,'package.json'))('yaml')
const readJson=async path=>JSON.parse(await readFile(path,'utf8'))
const checked=await readJson(join(baseline.profile,'package.json')),current=await readJson(join(baseline.source,'package.json'))
const main='@veewo/dsh-better-tasks'
const withoutMain=deps=>Object.fromEntries(Object.entries(deps??{}).filter(([name])=>name!==main))
assert.deepEqual(withoutMain(current.dependencies),withoutMain(checked.dependencies),'Unrelated direct dependencies changed: revalidate the current composition')
assert.deepEqual(current.dsh.profile.bundles.filter(x=>x!==main),checked.dsh.profile.bundles.filter(x=>x!==main),'Other bundle selection changed')
function normalize(value,base){
 if(typeof value==='string')return value.replace(/file:([^()]*?\.tgz)/g,(_,path)=>'file:'+resolve(base,path).replaceAll('\\','/'))
 if(Array.isArray(value))return value.map(x=>normalize(x,base))
 if(value!==null&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[normalize(key,base),normalize(item,base)]))
 return value
}
const a=normalize(parse(await readFile(join(baseline.profile,'pnpm-lock.yaml'),'utf8')),baseline.profile)
const b=normalize(parse(await readFile(join(baseline.source,'pnpm-lock.yaml'),'utf8')),baseline.source)
// These are the intentional changes in this narrow release, not a general ignore list.
const changed=process.argv[3]?.split(',')??[main,'@deepseek-ai/dsh-client-ui-workspace']
assert.ok(changed.includes(main)&&new Set(changed).size===changed.length&&changed.every(name=>baseline.candidates.some(row=>row.name===name)),'Only explicitly updated candidate packages may be excluded')
for(const section of ['packages','snapshots']){
 const retained=value=>Object.fromEntries(Object.entries(value).filter(([key])=>!changed.some(name=>key.startsWith(name+'@'))))
 assert.deepEqual(retained(b[section]),retained(a[section]),`Unrelated ${section} changed`)
}
assert.deepEqual(b.settings,a.settings)
const stripConfig=value=>Array.isArray(value)?value.map(stripConfig):value!==null&&typeof value==='object'
 ?Object.fromEntries(Object.entries(value).filter(([key])=>key!=='config').map(([key,item])=>[key,stripConfig(item)])):value
const sandboxPatch=parse(await readFile(join(baseline.profile,'cordis.patch.yml'),'utf8'))
assert.equal(sandboxPatch.at(-2)?.id,'dsh-cindy-host');assert.equal(sandboxPatch.at(-2)?.disabled,true)
assert.equal(sandboxPatch.at(-1)?.id,'webserver');assert.equal(sandboxPatch.at(-1)?.config?.port,39422)
const realPatch=parse(await readFile(join(baseline.source,'cordis.patch.yml'),'utf8'))
assert.deepEqual(stripConfig(realPatch),stripConfig(sandboxPatch.slice(0,-2)),'User composition rows changed')
const report={result:'PASS',checkedAt:new Date().toISOString(),intentionalChangedPackages:changed,unrelatedDependenciesAndCompositionUnchanged:true,userConfigValuesPreservedNotOverwritten:true}
await writeFile(join(baseline.release,'preinstall-consistency.json'),JSON.stringify(report,null,2)+'\n')
console.log(JSON.stringify(report,null,2))
