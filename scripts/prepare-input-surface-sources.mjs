// Add only the three input packages; never restage the already-patched workspace.
import {cp,mkdir,readFile,writeFile,access} from 'node:fs/promises'
import {resolve,join} from 'node:path'
const root=resolve(import.meta.dirname,'..'),build=join(root,'.srcbuild')
const source=resolve(process.argv[2]??'C:/Users/chany/AppData/Local/Temp/dsh-src-dsh-v0.2.0-rc.2/deepseek-harness-dsh-v0.2.0-rc.2')
const slugs=['ui-input-trigger','ui-commands','ui-conversation']
const manifest=JSON.parse(await readFile(join(build,'package.json'),'utf8'))
for(const slug of slugs){
 const from=join(source,'packages/client',slug),to=join(build,'packages/client',slug)
 try{await access(to);throw new Error(`${slug} already staged; refusing to overwrite`)}catch(e){if(e.code!=='ENOENT')throw e}
 await mkdir(to,{recursive:true});await cp(from,to,{recursive:true})
 let config=JSON.parse(await readFile(join(to,'tsconfig.json'),'utf8'))
 // Conversation is a split host/client project; its root config is only a reference list.
 if(!config.extends && config.files?.length===0)config=JSON.parse(await readFile(join(to,'tsconfig.client.json'),'utf8'))
 delete config.references
 await writeFile(join(to,'tsconfig.json'),JSON.stringify(config,null,2)+'\n')
 await writeFile(join(to,'tsdown.build.ts'),`import {clientBundle} from '../tsdown.client.ts'\nconst name='@deepseek-ai/dsh-client-${slug}'\nconst base=clientBundle(name,['lib/types/index.js'])\nexport default config=>base(config).filter(row=>row.name!==name)\n`)
 const pkg=JSON.parse(await readFile(join(from,'package.json'),'utf8'))
 for(const section of ['dependencies','devDependencies','peerDependencies','optionalDependencies']){
  for(const [name,version] of Object.entries(pkg[section]??{})){
   if(name.startsWith('@deepseek-ai/')||name.startsWith('@types/')||manifest.devDependencies[name])continue
   manifest.devDependencies[name]=version
  }
 }
}
await writeFile(join(build,'package.json'),JSON.stringify(manifest,null,2)+'\n')
console.log('Staged input source packages without changing previous three forks.')
