// Compare the npm-published client artifacts against the copy the DSH desktop app
// actually ships inside app.asar.
//
// The desktop runtime is the behavior baseline the forks must run against, so any
// difference between the published tarball and the app's bundled copy matters: a
// patch recorded against the published file would be fitted to the wrong source.
//
// Must run under the Electron binary (ELECTRON_RUN_AS_NODE=1) to read app.asar.
//
// usage: ELECTRON_RUN_AS_NODE=1 "<AppRoot>/DeepSeek Harness.exe" scripts/compare-app-baseline.mjs <appRoot>

import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { resolve, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const appRoot = process.argv[2] ?? 'H:\\Program Files\\Deepseek'
const version = process.argv[3] ?? '0.2.0-rc.2'
const appDsh = `${appRoot.replaceAll('\\', '/')}/resources/app.asar/dsh/node_modules/@deepseek-ai`

const packages = ['dsh-client-ui-layout', 'dsh-client-ui-workspace', 'dsh-client-ui-user-questions']
const slugs = { 'dsh-client-ui-layout': 'ui-layout', 'dsh-client-ui-workspace': 'ui-workspace', 'dsh-client-ui-user-questions': 'ui-user-questions' }

const sha256 = (value) => createHash('sha256').update(value).digest('hex')

async function filesBelow(path) {
  const out = []
  const walk = async (dir) => {
    let entries
    try { entries = await readdir(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      const child = `${dir}/${entry.name}`
      if (entry.isDirectory()) await walk(child)
      else if (entry.isFile()) out.push(child)
    }
  }
  await walk(path)
  return out
}

for (const name of packages) {
  const slug = slugs[name]
  const npmRoot = resolve(root, 'third_party', slug, version, 'package')
  const appPkgRoot = `${appDsh}/${name}`

  console.log(`=== ${name}@${version} ===`)
  let appManifest
  try {
    appManifest = JSON.parse(await readFile(`${appPkgRoot}/package.json`, 'utf8'))
    console.log(`app version: ${appManifest.version}`)
  } catch (error) {
    console.log(`app copy unreadable: ${error.message}`)
    continue
  }

  const npmFiles = (await filesBelow(npmRoot)).map((file) => relative(npmRoot, file).replaceAll('\\', '/')).sort()
  const appFiles = (await filesBelow(appPkgRoot)).map((file) => relative(appPkgRoot, file).replaceAll('\\', '/')).sort()

  const onlyNpm = npmFiles.filter((file) => !appFiles.includes(file))
  const onlyApp = appFiles.filter((file) => !npmFiles.includes(file))
  const differs = []
  for (const file of npmFiles.filter((f) => appFiles.includes(f))) {
    const [a, b] = await Promise.all([readFile(resolve(npmRoot, file)), readFile(`${appPkgRoot}/${file}`)])
    if (sha256(a) !== sha256(b)) differs.push({ file, npm: sha256(a), app: sha256(b), npmSize: a.length, appSize: b.length })
  }

  console.log(`files: npm ${npmFiles.length}, app ${appFiles.length}, identical ${npmFiles.filter((f) => appFiles.includes(f)).length - differs.length}`)
  console.log(`only in npm: ${onlyNpm.join(', ') || '(none)'}`)
  console.log(`only in app: ${onlyApp.join(', ') || '(none)'}`)
  if (differs.length === 0) console.log('DIFFERS: (none) - published artifact is the app behavior baseline')
  else {
    console.log('DIFFERS:')
    for (const d of differs) console.log(`  ${d.file}  npm ${d.npm.slice(0, 12)} (${d.npmSize}B)  app ${d.app.slice(0, 12)} (${d.appSize}B)`)
  }
  console.log('')
}
