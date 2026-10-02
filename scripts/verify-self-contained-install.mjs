import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
const root=resolve(import.meta.dirname,'..'), sandbox=resolve(root,process.argv[2]), release=resolve(root,process.argv[3])
const profile=join(sandbox,'home/profiles/desktop'), main=join(profile,'node_modules/@veewo/dsh-better-tasks')
const forks=JSON.parse(await readFile(join(release,'forks-manifest.json'),'utf8')).assets
const pkg=JSON.parse(await readFile(join(main,'package.json'),'utf8'))
assert.equal(pkg.version,'0.3.1')
const sha=bytes=>createHash('sha256').update(bytes).digest('hex')
const checks=[]
for(const asset of forks){
  const path=join(main,'node_modules',asset.name)
  assert.equal(JSON.parse(await readFile(join(path,'package.json'),'utf8')).name,asset.name)
  assert.equal(sha(await readFile(join(path,'lib/client.js'))),asset.clientSha256)
  assert.equal(createRequire(join(main,'package.json')).resolve(asset.name+'/package.json'),join(path,'package.json'))
  checks.push({name:asset.name,clientSha256:asset.clientSha256,source:'bundled main node_modules'})
}
const ws=await readFile(join(profile,'pnpm-workspace.yaml'),'utf8')
assert.doesNotMatch(ws,/blockExoticSubdeps:\s*false|strictPeerDependencies:\s*false/)
const patch=await readFile(join(main,'cordis.patch.yml'),'utf8')
assert.match(patch,/name: '@veewo\/dsh-better-tasks\/fork-layer'/)
for(const id of ['ui-input-trigger','ui-commands','ui-conversation'])assert.ok(patch.includes(`        - id: ${id}\n`))
const result={result:'PASS',version:pkg.version,defaultProtectionPreserved:true,nativeOptionIdsPreserved:true,forks:checks}
await writeFile(join(release,'installed-candidate-verification.json'),JSON.stringify(result,null,2)+'\n')
console.log(JSON.stringify(result,null,2))
