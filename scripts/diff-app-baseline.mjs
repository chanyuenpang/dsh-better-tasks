// Show the exact text difference between a published client artifact and the copy the
// desktop app bundles in app.asar, for one package.
//
// usage: ELECTRON_RUN_AS_NODE=1 "<AppRoot>/DeepSeek Harness.exe" scripts/diff-app-baseline.mjs <slug> <version> [appRoot]

import { readFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createTwoFilesPatch } from 'diff'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const [slug, version, appRootArg] = process.argv.slice(2)
const appRoot = appRootArg ?? 'H:\\Program Files\\Deepseek'
const packages = {
  'ui-layout': 'dsh-client-ui-layout',
  'ui-workspace': 'dsh-client-ui-workspace',
  'ui-user-questions': 'dsh-client-ui-user-questions',
}
const name = packages[slug]
const appDsh = `${appRoot.replaceAll('\\', '/')}/resources/app.asar/dsh/node_modules/@deepseek-ai`

const file = process.argv.includes('--package-json') ? 'package.json' : 'lib/client.js'
const npmText = await readFile(resolve(root, 'third_party', slug, version, 'package', file), 'utf8')
const appText = await readFile(`${appDsh}/${name}/${file}`, 'utf8')

if (npmText === appText) {
  console.log(`${slug} ${file}: identical`)
} else {
  console.log(createTwoFilesPatch(`npm/${file}`, `app/${file}`, npmText, appText, '', '', { context: 2 }))
}
