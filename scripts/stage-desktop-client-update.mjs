// Update only Better Tasks; retain the exact already-accepted fork archives.
import {cp,mkdir,readFile,writeFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {createHash} from 'node:crypto'
import {spawnSync} from 'node:child_process'
import assert from 'node:assert/strict'
const root=resolve(import.meta.dirname,'..')
const version=process.argv[2],out=process.argv[3]
assert.match(version??'',/^0\.2\.\d+$/)
assert.ok(out,'release directory required')
const destination=resolve(root,out)
const base=resolve(root,process.argv[4]??'releases/0.2.7-desktop-startup')
const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
const records=JSON.parse(await readFile(join(base,'candidates.json'),'utf8')).filter(x=>x.slug!=='better-tasks')
assert.ok([3,6].includes(records.length),'expected the accepted legacy or full desktop fork composition')
assert.equal(new Set(records.map(row=>row.slug)).size,records.length)
for(const candidate of records){
 assert.equal(hash(await readFile(candidate.archive)),candidate.archiveSha256)
 assert.equal(hash(await readFile(join(root,'forks-0.2.0-rc.2',candidate.slug,'lib/client.js'))),candidate.clientSha256,'fork has changed; client-only update cannot silently include it')
}
await mkdir(destination)
const parent=join(destination,'better-tasks'),path=join(parent,'package')
await mkdir(path,{recursive:true})
for(const file of ['src','lib/client.js','LICENSE'])await cp(join(root,file),join(path,file),{recursive:true})
const basePackage=join(base,'better-tasks/package')
const manifest=JSON.parse(await readFile(join(basePackage,'package.json'),'utf8'))
manifest.version=version
await writeFile(join(path,'package.json'),JSON.stringify(manifest,null,2)+'\n')
await cp(join(basePackage,'cordis.patch.yml'),join(path,'cordis.patch.yml'))
const archive=join(destination,`veewo-dsh-better-tasks-${version}.tgz`)
const packed=spawnSync('tar',['-czf',archive,'-C',parent,'package'],{stdio:'inherit'})
if(packed.error)throw packed.error
assert.equal(packed.status,0,'archive creation failed')
records.push({slug:'better-tasks',name:manifest.name,version,archive,archiveSha256:hash(await readFile(archive)),clientSha256:hash(await readFile(join(path,'lib/client.js')))})
await writeFile(join(destination,'candidates.json'),JSON.stringify(records,null,2)+'\n')
console.log(JSON.stringify(records,null,2))
