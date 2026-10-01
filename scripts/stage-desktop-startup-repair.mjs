// Package the complete Desktop composition, never borrow installed fork bytes.
// Only Better Tasks is a bundle. Its three native-named fork dependencies are
// ordinary packages; do NOT pass those packages to install_bundle individually.
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { verifyForks } from './verify-fork-externals.mjs'
const root=resolve(import.meta.dirname,'..')
const destination=resolve(root,process.argv[2]??'releases/0.2.7-desktop-startup')
const version='0.2.7'
const slugs=['ui-layout','ui-workspace','ui-user-questions']
const slash=p=>p.replaceAll('\\','/')
const sha=bytes=>createHash('sha256').update(bytes).digest('hex')
const forks=resolve(root,'forks-0.2.0-rc.2')
// The validator fails closed on missing packages or unexpected runtime imports.
const checked=verifyForks({forkDir:forks})
if(checked.some(row=>row.state!=='PASS')||checked.length!==3)throw new Error('Desktop fork dependency gate failed')
await mkdir(destination)
const records=[]
const forkSpecs={}
for(const slug of [...slugs,'better-tasks']){
 const source=slug==='better-tasks'?root:join(forks,slug)
 const parent=join(destination,slug), path=join(parent,'package')
 await mkdir(path,{recursive:true})
 const files=slug==='better-tasks'?['src','lib/client.js','LICENSE']:['lib','LICENSE']
 for(const file of files)await cp(join(source,file),join(path,file),{recursive:true})
 const manifest=JSON.parse(await readFile(join(source,'package.json'),'utf8'))
 delete manifest.scripts;delete manifest.devDependencies
 manifest.files=files
 if(slug==='better-tasks'){
  manifest.version=version
  manifest.dependencies={...manifest.dependencies,...forkSpecs}
  manifest.dsh.bundle={patch:'./cordis.patch.yml'}
  manifest.files.push('cordis.patch.yml')
  await writeFile(join(path,'cordis.patch.yml'),`# One removable bundle layer; native-named forks are ordinary dependencies.
- id: ui-layout
  disabled: true
- id: ui-sidebar
  disabled: true
- id: ui-workspace
  disabled: true
- id: ui-user-questions
  disabled: true
- insert:
    - id: ui-layout-dbt
      name: '@deepseek-ai/dsh-client-ui-layout'
    - id: ui-workspace-dbt
      name: '@deepseek-ai/dsh-client-ui-workspace'
    - id: ui-user-questions-dbt
      name: '@deepseek-ai/dsh-client-ui-user-questions'
    - id: better-tasks-ui
      name: '@veewo/dsh-better-tasks'
`)
 }else if(manifest.dsh?.bundle)delete manifest.dsh.bundle
 await writeFile(join(path,'package.json'),JSON.stringify(manifest,null,2)+'\n')
 const archive=join(destination,`${manifest.name.replace('@','').replace('/','-')}-${manifest.version}.tgz`)
 const packed=spawnSync('tar',['-czf',archive,'-C',parent,'package'],{stdio:'inherit'})
 if(packed.error)throw packed.error
 if(packed.status!==0)throw new Error(`tar failed for ${slug}: ${packed.status}`)
 const client=await readFile(join(path,'lib/client.js'))
 records.push({slug,name:manifest.name,version:manifest.version,archive,archiveSha256:sha(await readFile(archive)),clientSha256:sha(client)})
 if(slug!=='better-tasks')forkSpecs[manifest.name]='file:'+slash(archive)
}
await writeFile(join(destination,'candidates.json'),JSON.stringify(records,null,2)+'\n')
console.log(JSON.stringify(records,null,2))
