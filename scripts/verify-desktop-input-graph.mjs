// Compare the installed graph with the cold-started graph, resolving profile-relative tarballs.
import {readFile,writeFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {createRequire} from 'node:module'
import {createHash} from 'node:crypto'
import assert from 'node:assert/strict'
const sandbox=resolve(process.argv[2]??'sandbox/.desktop-input-029')
const baseline=JSON.parse(await readFile(join(sandbox,'baseline.json'),'utf8'))
const real=baseline.source,checked=baseline.profile
const {parse}=createRequire(join(real,'package.json'))('yaml')
function normalize(value,base){
 if(typeof value==='string')return value.replace(/file:([^()]*?\.tgz)/g,(_,path)=>'file:'+resolve(base,path).replaceAll('\\','/'))
 if(Array.isArray(value))return value.map(item=>normalize(item,base))
 if(value!==null&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[normalize(key,base),normalize(item,base)]).sort(([a],[b])=>a.localeCompare(b)))
 return value
}
const a=normalize(parse(await readFile(join(checked,'pnpm-lock.yaml'),'utf8')),checked)
const b=normalize(parse(await readFile(join(real,'pnpm-lock.yaml'),'utf8')),real)
for(const key of ['settings','importers','packages','snapshots'])assert.deepEqual(b[key],a[key],`Installed ${key} differs from cold-started graph`)
const digest=createHash('sha256').update(JSON.stringify({settings:a.settings,importers:a.importers,packages:a.packages,snapshots:a.snapshots})).digest('hex')
const report={result:'PASS',checkedAt:new Date().toISOString(),normalizedGraphSha256:digest,packages:Object.keys(a.packages).length,snapshots:Object.keys(a.snapshots).length,normalization:'file: tarballs resolved against each profile; all settings/importers/package resolutions/dependency snapshots compared',realProfileWritten:false}
await writeFile(join(baseline.release,'dependency-graph-verification.json'),JSON.stringify(report,null,2)+'\n')
console.log(JSON.stringify(report,null,2))
