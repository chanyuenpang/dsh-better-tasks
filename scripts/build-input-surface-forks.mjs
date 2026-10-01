// Build selected already-staged desktop forks (defaults: the three input forks).
// Optional args: source-root, comma-separated slugs, provenance report filename. Never restage.
import {readFile,writeFile,mkdir,cp,readdir} from 'node:fs/promises'
import {openSync,closeSync} from 'node:fs'
import {createRequire} from 'node:module'
import {createHash} from 'node:crypto'
import {resolve,join,relative,dirname} from 'node:path'
import {spawnSync} from 'node:child_process'
import assert from 'node:assert/strict'
import {FORK_SLUGS,INPUT_FORK_SLUGS,assertForkExternals,assertResolvedBuildLog} from './verify-fork-externals.mjs'
const root=resolve(import.meta.dirname,'..'),build=join(root,'.srcbuild')
const source=resolve(process.argv[2]??'C:/Users/chany/AppData/Local/Temp/dsh-src-dsh-v0.2.0-rc.2/deepseek-harness-dsh-v0.2.0-rc.2')
const lock=JSON.parse(await readFile(join(root,'provenance/source.lock.json'),'utf8'))
const ts=createRequire(join(build,'package.json'))('typescript')
const sha=bytes=>createHash('sha256').update(bytes).digest('hex')
const walk=async path=>{const files=[];for(const entry of await readdir(path,{withFileTypes:true})){const child=join(path,entry.name);files.push(...entry.isDirectory()?await walk(child):[child])}return files}
const env={...process.env,DSH_CLIENT_COMMIT_HASH:lock.commit,DSH_CLIENT_TITLE:lock.title,DSH_CLIENT_BUILD_PROFILE:lock.profile,NODE_ENV:'production'}
delete env.DSH_BUILD_FACE
const selected=process.argv[3]?.split(',')??INPUT_FORK_SLUGS
assert.ok(selected.length&&new Set(selected).size===selected.length&&selected.every(slug=>[...FORK_SLUGS,...INPUT_FORK_SLUGS].includes(slug)))
const results=[]
for(const slug of selected){
 const path=join(build,'packages/client',slug)
 const logPath=join(root,'sandbox',`${slug}-surface-build.log`),fd=openSync(logPath,'w')
 let built
 try{built=spawnSync(process.execPath,[join(build,'node_modules/tsdown/dist/run.mjs'),'--config','tsdown.build.ts'],{cwd:path,env,stdio:['ignore',fd,fd]})}finally{closeSync(fd)}
 if(built.error)throw built.error
 assert.equal(built.status,0,`${slug} build failed: ${logPath}`)
 assertResolvedBuildLog(await readFile(logPath,'utf8'),slug)
 let client=await readFile(join(path,'lib/client.js'),'utf8')
 if(client.includes('__BUILD_REVISION__')){
  const hash=createHash('sha256')
  for(const file of (await walk(join(path,'src'))).sort())hash.update(await readFile(file))
  client=client.replaceAll('__BUILD_REVISION__',hash.digest('hex'))
 }
 const verification=assertForkExternals(slug,client,{version:lock.version})
 const pristine=join(root,'third_party',slug,lock.version,'package'),target=join(root,`forks-${lock.version}`,slug)
 await mkdir(target,{recursive:true})
 await cp(pristine,target,{recursive:true})
 await writeFile(join(target,'lib/client.js'),client)
 const declarations=[]
 // Keep upstream declarations for unchanged files; regenerate every changed/added TS declaration.
 for(const file of await walk(join(path,'src'))){
  if(!/\.tsx?$/.test(file)||file.endsWith('.d.ts'))continue
  const rel=relative(path,file),code=await readFile(file,'utf8')
  let original;try{original=await readFile(join(source,'packages/client',slug,rel),'utf8')}catch(e){if(e.code!=='ENOENT')throw e}
  if(code===original)continue
  const result=ts.transpileDeclaration(code,{fileName:file,compilerOptions:{target:ts.ScriptTarget.ESNext,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}})
  const errors=result.diagnostics?.filter(d=>d.category===ts.DiagnosticCategory.Error)??[]
  if(errors.length && original !== undefined){
   // Implementation-only edits (e.g. apply's /file route) may retain upstream
   // inferred exports that isolated emission cannot resolve. Preserve the exact
   // official declaration only when old/new emitted declarations are identical.
   const baseline=ts.transpileDeclaration(original,{fileName:file,compilerOptions:{target:ts.ScriptTarget.ESNext,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}})
   if(baseline.outputText===result.outputText)continue
  }
  if(errors.length)throw new Error(`${slug}/${rel}: declaration emission failed\n`+ts.formatDiagnosticsWithColorAndContext(errors,{getCanonicalFileName:p=>p,getCurrentDirectory:()=>root,getNewLine:()=> '\n'}))
  const output=join(target,'lib/types',relative(join(path,'src'),file).replace(/\.tsx?$/,'.d.ts'))
  await mkdir(dirname(output),{recursive:true});await writeFile(output,result.outputText)
  declarations.push(relative(target,output))
 }
 const archive=join(root,'third_party',slug,lock.version,`${INPUT_FORK_SLUGS.includes(slug)?'deepseek-ai-':''}dsh-client-${slug}-${lock.version}.tgz`)
 results.push({slug,clientSha256:sha(client),officialArchiveSha256:sha(await readFile(archive)),officialClientSha256:sha(await readFile(join(pristine,'lib/client.js'))),moduleEdges:verification.forkSpecifiers,declarations})
 console.log(`PASS ${slug}: ${Buffer.byteLength(client)} bytes; ${declarations.length} updated declarations`)
}
await writeFile(join(root,'provenance',process.argv[4]??'input-surface-build.json'),JSON.stringify({version:lock.version,sourceCommit:lock.commit,results},null,2)+'\n')
