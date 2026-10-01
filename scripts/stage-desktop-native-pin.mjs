// Release only Better Tasks + workspace, reusing every other accepted 0.2.10 archive.
import {cp,mkdir,readFile,writeFile,access} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {createHash} from 'node:crypto'
import {spawnSync} from 'node:child_process'
import assert from 'node:assert/strict'
import {verifyForks} from './verify-fork-externals.mjs'
const root=resolve(import.meta.dirname,'..'),version=process.argv[2],out=process.argv[3]
assert.match(version??'',/^0\.2\.\d+$/);assert.ok(out,'immutable release directory required')
const destination=resolve(root,out),base=join(root,'releases/0.2.10-desktop-input-style'),forks=join(root,'forks-0.2.0-rc.2')
const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
const records=JSON.parse(await readFile(join(base,'candidates.json'),'utf8')).filter(row=>!['better-tasks','ui-workspace'].includes(row.slug))
assert.equal(records.length,5)
for(const row of records){
 assert.equal(hash(await readFile(row.archive)),row.archiveSha256)
 assert.equal(hash(await readFile(join(forks,row.slug,'lib/client.js'))),row.clientSha256,'Unrelated fork bytes changed')
}
assert.equal(verifyForks({forkDir:forks,slugs:['ui-workspace']})[0].state,'PASS')
const build=JSON.parse(await readFile(join(root,'provenance/workspace-native-pin-build.json'),'utf8'))
assert.equal(hash(await readFile(join(forks,'ui-workspace/lib/client.js'))),build.results[0].clientSha256)
for(const file of ['task-pins.d.ts','task-pins.d.ts.map']){
 try{await access(join(forks,'ui-workspace/lib/types/client',file));throw new Error('Removed bridge declaration remains: '+file)}catch(error){if(error.code!=='ENOENT')throw error}
}
await mkdir(destination)
let workspaceSpec
for(const slug of ['ui-workspace','better-tasks']){
 const main=slug==='better-tasks',from=main?root:join(forks,slug)
 const parent=join(destination,slug),path=join(parent,'package');await mkdir(path,{recursive:true})
 const files=main?['src','lib/client.js','LICENSE']:['lib','LICENSE']
 for(const file of files)await cp(join(from,file),join(path,file),{recursive:true})
 const manifest=JSON.parse(await readFile(main?join(base,'better-tasks/package/package.json'):join(from,'package.json'),'utf8'))
 delete manifest.scripts;delete manifest.devDependencies;manifest.files=files
 if(main){
  manifest.version=version
  manifest.dependencies={...manifest.dependencies,'@deepseek-ai/dsh-client-ui-workspace':workspaceSpec}
  manifest.files.push('cordis.patch.yml');await cp(join(base,'better-tasks/package/cordis.patch.yml'),join(path,'cordis.patch.yml'))
 }
 await writeFile(join(path,'package.json'),JSON.stringify(manifest,null,2)+'\n')
 const archive=join(destination,`${manifest.name.replace('@','').replace('/','-')}-${manifest.version}.tgz`)
 const packed=spawnSync('tar',['-czf',archive,'-C',parent,'package'],{stdio:'inherit'})
 if(packed.error)throw packed.error;assert.equal(packed.status,0)
 records.push({slug,name:manifest.name,version:manifest.version,archive,archiveSha256:hash(await readFile(archive)),clientSha256:hash(await readFile(join(path,'lib/client.js')))})
 if(!main)workspaceSpec='file:'+archive.replaceAll('\\','/')
}
await writeFile(join(destination,'candidates.json'),JSON.stringify(records,null,2)+'\n')
console.log(JSON.stringify(records,null,2))
