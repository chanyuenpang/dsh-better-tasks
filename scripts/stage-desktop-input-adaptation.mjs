// Package the in-card native input adaptation, preserving the prior three fork archives.
import {cp,mkdir,readFile,writeFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {createHash} from 'node:crypto'
import {spawnSync} from 'node:child_process'
import assert from 'node:assert/strict'
import {INPUT_FORK_SLUGS,verifyForks} from './verify-fork-externals.mjs'
const root=resolve(import.meta.dirname,'..'),version=process.argv[2],out=process.argv[3]
assert.match(version??'',/^0\.2\.\d+$/);assert.ok(out,'immutable release directory required')
const destination=resolve(root,out),base=join(root,'releases/0.2.8-desktop-selection'),forks=join(root,'forks-0.2.0-rc.2')
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),slash=p=>p.replaceAll('\\','/')
const records=JSON.parse(await readFile(join(base,'candidates.json'),'utf8')).filter(x=>x.slug!=='better-tasks')
assert.equal(records.length,3)
for(const candidate of records){
 assert.equal(sha(await readFile(candidate.archive)),candidate.archiveSha256)
 assert.equal(sha(await readFile(join(forks,candidate.slug,'lib/client.js'))),candidate.clientSha256)
}
const checked=verifyForks({forkDir:forks,slugs:INPUT_FORK_SLUGS})
assert.equal(checked.length,3);assert.ok(checked.every(x=>x.state==='PASS'),JSON.stringify(checked))
const build=JSON.parse(await readFile(join(root,'provenance/input-surface-build.json'),'utf8'))
for(const candidate of checked)assert.equal(candidate.forkSha,build.results.find(x=>x.slug===candidate.slug)?.clientSha256)
await mkdir(destination)
const specs={}
for(const slug of [...INPUT_FORK_SLUGS,'better-tasks']){
 const parent=join(destination,slug),path=join(parent,'package')
 await mkdir(path,{recursive:true})
 const main=slug==='better-tasks',from=main?root:join(forks,slug)
 const files=main?['src','lib/client.js','LICENSE']:['lib','LICENSE']
 for(const file of files)await cp(join(from,file),join(path,file),{recursive:true})
 const manifest=JSON.parse(await readFile(main?join(base,'better-tasks/package/package.json'):join(from,'package.json'),'utf8'))
 delete manifest.scripts;delete manifest.devDependencies
 manifest.files=files
 if(main){
  manifest.version=version
  manifest.peerDependencies=Object.fromEntries(Object.entries(manifest.peerDependencies??{}).map(([name,range])=>[name,name.startsWith('@deepseek-ai/dsh-')?'0.2.0-rc.2':range]))
  manifest.dependencies={...manifest.dependencies,...specs}
  // Native input rows remain at their existing ids/configuration. Profile package
  // resolution supplies the matching fork bytes; do not replace user settings.
  manifest.files.push('cordis.patch.yml')
  await cp(join(base,'better-tasks/package/cordis.patch.yml'),join(path,'cordis.patch.yml'))
 }else if(manifest.dsh?.bundle)delete manifest.dsh.bundle
 await writeFile(join(path,'package.json'),JSON.stringify(manifest,null,2)+'\n')
 const archive=join(destination,`${manifest.name.replace('@','').replace('/','-')}-${manifest.version}.tgz`)
 const packed=spawnSync('tar',['-czf',archive,'-C',parent,'package'],{stdio:'inherit'})
 if(packed.error)throw packed.error
 assert.equal(packed.status,0,`tar failed for ${slug}`)
 records.push({slug,name:manifest.name,version:manifest.version,archive,archiveSha256:sha(await readFile(archive)),clientSha256:sha(await readFile(join(path,'lib/client.js')))})
 if(!main)specs[manifest.name]='file:'+slash(archive)
}
await writeFile(join(destination,'candidates.json'),JSON.stringify(records,null,2)+'\n')
console.log(JSON.stringify(records,null,2))
