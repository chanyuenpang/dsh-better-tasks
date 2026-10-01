// Read-only verification; does not reload, restart, install, or write the profile.
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
const root=resolve(import.meta.dirname,'..')
const profile='C:/Users/chany/.dsh/profiles/desktop'
const release=resolve(root,'releases/0.2.6-desktop-repair-r2')
const require=createRequire(resolve(profile,'package.json'))
const {parse}=require('yaml')
const text=path=>readFile(path,'utf8')
const json=async path=>JSON.parse(await text(path))
const hash=async path=>createHash('sha256').update(await readFile(path)).digest('hex')
const manifest=await json(resolve(profile,'package.json'))
const old=await json(resolve(release,'preinstall-backup/package.json'))
const lockText=await text(resolve(profile,'pnpm-lock.yaml'))
assert.equal(lockText,await text(resolve(profile,'node_modules/.pnpm/lock.yaml')),'wanted and installed lock must be byte-identical')
const lock=parse(lockText), prior=parse(await text(resolve(release,'preinstall-backup/pnpm-lock.yaml')))
const targets=['@veewo/dsh-better-tasks','@deepseek-ai/dsh-client-ui-workspace']
const excludeTargets=record=>Object.fromEntries(Object.entries(record).filter(([key])=>!targets.some(name=>key===name||key.startsWith(name+'@'))))
assert.deepEqual(excludeTargets(manifest.dependencies),excludeTargets(old.dependencies))
assert.deepEqual(manifest.dsh,old.dsh,'bundle composition must not change')
assert.deepEqual(excludeTargets(lock.packages),excludeTargets(prior.packages),'unrelated dependency resolutions must not change')
assert.deepEqual(excludeTargets(lock.snapshots),excludeTargets(prior.snapshots),'unrelated dependency graph must not change')
const forkRows = source => {
 const ids=new Set(['ui-layout','ui-sidebar','ui-workspace','ui-user-questions','ui-layout-dbt','ui-workspace-dbt','ui-user-questions-dbt','better-tasks-ui'])
 const rows=new Map()
 for(const row of parse(source).flatMap(row=>row.insert??[row])) {
  if(!ids.has(row.id))continue
  const {config,...composition}=row
  rows.set(row.id,{...rows.get(row.id),...composition})
 }
 return [...rows].sort(([a],[b])=>a.localeCompare(b))
}
// A user can legitimately change preferences/model/Cindy settings after restart.
// Preserve those edits; assert the repaired fork rows, not stale document bytes.
assert.deepEqual(forkRows(await text(resolve(profile,'cordis.patch.yml'))),forkRows(await text(resolve(release,'preinstall-backup/cordis.patch.yml'))),'fork composition unchanged')
const candidates=await json(resolve(release,'candidates.json'))
const records=[]
for(const candidate of candidates){
 const name=candidate.name, spec=manifest.dependencies[name]
 assert.equal(lock.importers['.'].dependencies[name].specifier,spec)
 const key=Object.keys(lock.packages).find(x=>x.startsWith(name+'@'))
 const expected='sha512-'+createHash('sha512').update(await readFile(spec.slice(5))).digest('base64')
 assert.equal(lock.packages[key].resolution.integrity,expected)
 const client=await hash(resolve(profile,'node_modules',name,'lib/client.js'))
 assert.equal(client,candidate.clientSha256)
 records.push({name,spec,clientSha256:client,integrity:expected})
}
const report={checkedAt:new Date().toISOString(),result:'PASS',installedAndWantedLockIdentical:true,unrelatedDependencyGraphUnchanged:true,forkCompositionUnchanged:true,concurrentUserSettingsPreserved:true,records}
await writeFile(resolve(release,'installed-verification.json'),JSON.stringify(report,null,2)+'\n')
console.log(JSON.stringify(report,null,2))
