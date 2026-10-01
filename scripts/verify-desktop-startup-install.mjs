// Read-only real-profile verification; output evidence only to the workspace.
import {readFile,writeFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {createHash} from 'node:crypto'
import {createRequire} from 'node:module'
import assert from 'node:assert/strict'
const root=resolve(import.meta.dirname,'..'),release=resolve(root,process.argv[2]??'releases/0.2.7-desktop-startup')
const application=process.argv[3]??'applied'
assert.ok(['applied','restart-required'].includes(application))
const profile='C:/Users/chany/.dsh/profiles/desktop'
const text=p=>readFile(p,'utf8'),json=async p=>JSON.parse(await text(p))
const digest=(bytes,algorithm='sha256',encoding='hex')=>createHash(algorithm).update(bytes).digest(encoding)
const {parse}=createRequire(join(profile,'package.json'))('yaml')
const candidates=await json(join(release,'candidates.json'))
const manifest=await json(join(profile,'package.json')),before=await json(join(release,'preinstall-backup/package.json'))
const name='@veewo/dsh-better-tasks'
const withoutMain=deps=>Object.fromEntries(Object.entries(deps).filter(([id])=>id!==name))
assert.deepEqual(withoutMain(manifest.dependencies),withoutMain(before.dependencies))
assert.deepEqual(manifest.dsh.profile.bundles.filter(id=>id!==name),before.dsh.profile.bundles.filter(id=>id!==name))
assert.ok(manifest.dsh.profile.bundles.includes(name))
const lockText=await text(join(profile,'pnpm-lock.yaml'))
assert.equal(lockText,await text(join(profile,'node_modules/.pnpm/lock.yaml')))
const lock=parse(lockText)
const currentPatch=parse(await text(join(profile,'cordis.patch.yml')))
const oldPatch=parse(await text(join(release,'preinstall-backup/cordis.patch.yml')))
// Preserve concurrently observed view preferences rather than restoring a stale backup.
const viewBefore=oldPatch.find(row=>row.id==='ui-chat')?.config?.transcriptView
const viewAfter=currentPatch.find(row=>row.id==='ui-chat')?.config?.transcriptView
const oldRows=new Map(oldPatch.map(row=>[row.id,JSON.stringify(row)]))
const observedChangedRowIds=currentPatch.filter(row=>oldRows.get(row.id)!==JSON.stringify(row)).map(row=>row.id)
// Settings remain live while verification runs (model selection also writes here).
// Record differences, never revert them or pretend this file is an immutable lock.
for(const row of currentPatch)assert.ok(!(['ui-layout','ui-sidebar','ui-workspace','ui-user-questions'].includes(row.id)&&row.disabled===true),'replacement disables must belong to removable bundle, not user layer')
const records=[]
for(const candidate of candidates){
 const archive=await readFile(candidate.archive)
 assert.equal(digest(archive),candidate.archiveSha256)
 const client=await readFile(join(profile,'node_modules',candidate.name,'lib/client.js'))
 assert.equal(digest(client),candidate.clientSha256)
 const resolution=Object.entries(lock.packages).filter(([id])=>id.startsWith(candidate.name+'@'))
 assert.equal(resolution.length,1)
 const integrity='sha512-'+digest(archive,'sha512','base64')
 assert.equal(resolution[0][1].resolution.integrity,integrity)
 records.push({...candidate,integrity})
}
const report={result:'PASS',checkedAt:new Date().toISOString(),packageManagerApplication:application,wantedAndInstalledLockIdentical:true,unrelatedDirectDependenciesAndBundleSelectionPreserved:true,userLayerWrittenByVerifier:false,observedChangedRowIds,observedTranscriptViewChange:{before:viewBefore,after:viewAfter},records,runtimeStateNotCheckedByThisScript:true,pendingRealRestart:application==='restart-required',agentRestartPerformed:false}
await writeFile(join(release,'installed-verification.json'),JSON.stringify(report,null,2)+'\n')
console.log(JSON.stringify(report,null,2))
