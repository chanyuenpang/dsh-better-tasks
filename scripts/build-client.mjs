import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pinClientPath = resolve(root, 'src/pin-client.mjs')
const preferencesPath = resolve(root, 'src/task-preferences.mjs')
const modelPath = resolve(root, 'src/task-model.mjs')
const actionsPath = resolve(root, 'src/task-actions.mjs')
const skillPickerPath = resolve(root, 'src/skill-picker.mjs')
const inputSurfacePath = resolve(root, 'src/task-input-surface.mjs')
const clientPath = resolve(root, 'src/client.js')
const outputPath = resolve(root, 'lib/client.js')

const stripExports = (source) => source
  .replace(/^export\s+(?=(const|function|async\s+function)\s)/gm, '')
  .replace(/^export\s*\{[\s\S]*?\}\s*from\s*['"][^'"]+['"]\s*;?\s*$/gm, '')

const pinClientSource = stripExports(await readFile(pinClientPath, 'utf8'))
const preferencesSource = stripExports(await readFile(preferencesPath, 'utf8'))
const modelSource = stripExports(await readFile(modelPath, 'utf8'))
const actionsSource = stripExports(await readFile(actionsPath, 'utf8'))
const skillPickerSource = stripExports(await readFile(skillPickerPath, 'utf8'))
const inputSurfaceSource = stripExports((await readFile(inputSurfacePath, 'utf8'))
  .replace(/^import\s*\{[^}]*\}\s*from\s*['"]\.\/task-actions\.mjs['"]\s*;?\s*/m, ''))
const rawClientSource = await readFile(clientPath, 'utf8')
const clientSource = stripExports(rawClientSource
  .replace(/^import\s*\{[\s\S]*?\}\s*from\s*['"]\.\/task-model\.mjs['"]\s*;?\s*/m, '')
  .replace(/^import\s*\{[\s\S]*?\}\s*from\s*['"]\.\/pin-client\.mjs['"]\s*;?\s*/m, '')
  .replace(/^import\s*\{[\s\S]*?\}\s*from\s*['"]\.\/task-preferences\.mjs['"]\s*;?\s*/m, '')
  .replace(/^import\s*\{[^}]*\}\s*from\s*['"]\.\/task-actions\.mjs['"]\s*;?\s*/m, '')
  .replace(/^import\s*\{[^}]*\}\s*from\s*['"]\.\/skill-picker\.mjs['"]\s*;?\s*/m, '')
  .replace(/^import\s*\{[^}]*\}\s*from\s*['"]\.\/task-input-surface\.mjs['"]\s*;?\s*/m, ''))

const output = `window.__ModuleLoader__.load({\n  id: "@veewo/dsh-better-tasks",\n  factory: requireModule => {\n${indent(pinClientSource, 4)}\n${indent(preferencesSource, 4)}
${indent(modelSource, 4)}\n${indent(actionsSource, 4)}\n${indent(skillPickerSource, 4)}\n${indent(inputSurfaceSource, 4)}\n${indent(clientSource, 4)}\n    return { name, inject, apply, contract }\n  },\n})\n`

await mkdir(dirname(outputPath), { recursive: true })
// Build revision: the render probe stores it in every payload, and the browser's
// localStorage is an append log, so only payloads carrying THIS build's revision
// prove the column rendered after this install. Hashed over the sources
// (placeholder included), which is deterministic and computable before the
// artifact exists — an artifact cannot stamp the artifact that contains it.
const revision = createHash('sha256')
  .update([
    pinClientSource, preferencesSource, modelSource, actionsSource, skillPickerSource, inputSurfaceSource, clientSource,
  ].join('\u0000'))
  .digest('hex')
const stamped = output.replaceAll('__BUILD_REVISION__', revision)
if (stamped.includes('__BUILD_REVISION__')) throw new Error('build revision placeholder survived the template')
await writeFile(outputPath, stamped, 'utf8')
console.log(`lib/client.js revision ${revision}`)

function indent(value, spaces) {
  const prefix = ' '.repeat(spaces)
  return value.split('\n').map((line) => line === '' ? '' : prefix + line).join('\n')
}
