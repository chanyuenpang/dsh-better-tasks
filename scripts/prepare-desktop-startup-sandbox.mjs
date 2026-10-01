// Prepare an independent profile for a real package-manager install of the bundle.
// No real profile write and no links to a real profile's installed fork artifacts.
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {createHash} from 'node:crypto'
const root=resolve(import.meta.dirname,'..')
const base=resolve(root,process.argv[2]??'sandbox/.desktop-startup-027')
const source='C:/Users/chany/.dsh/profiles/desktop'
const release=resolve(root,process.argv[3]??'releases/0.2.7-desktop-startup')
const candidates=JSON.parse(await readFile(join(release,'candidates.json'),'utf8'))
const candidate=candidates.find(x=>x.slug==='better-tasks')
const home=join(base,'home'),profile=join(home,'profiles/desktop')
await mkdir(base) // Immutable attempt; refuse reusing sessions, caches or logs.
await mkdir(profile,{recursive:true})
const before=await readFile(join(source,'package.json'),'utf8')
const manifest=JSON.parse(before)
manifest.dependencies={...manifest.dependencies,[candidate.name]:'file:'+candidate.archive.replaceAll('\\','/')}
manifest.dsh.profile.bundles=[...new Set([...manifest.dsh.profile.bundles,candidate.name])]
await writeFile(join(profile,'package.json'),JSON.stringify(manifest,null,2)+'\n')
for(const name of ['cordis.yml','pnpm-lock.yaml','pnpm-workspace.yaml'])await copyFile(join(source,name),join(profile,name))
const patch=await readFile(join(source,'cordis.patch.yml'),'utf8')
const safety=`\n# Sandbox-owned: no mobile/P2P side effects, no real profile storage.\n- id: dsh-cindy-host\n  disabled: true\n- id: webserver\n  config:\n    host: 127.0.0.1\n    port: 39422\n`
await writeFile(join(profile,'cordis.patch.yml'),patch+safety)
const baseline={createdAt:new Date().toISOString(),source,home,profile,release,candidates,profileManifestSha256:createHash('sha256').update(before).digest('hex'),profilePatchSha256:createHash('sha256').update(patch).digest('hex'),nodeLinker:'must retain copied hoisted policy',port:39422,cdp:9228}
await writeFile(join(base,'baseline.json'),JSON.stringify(baseline,null,2)+'\n')
console.log(JSON.stringify(baseline,null,2))
