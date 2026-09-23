import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pinClientPath = resolve(root, 'src/pin-client.mjs')
const modelPath = resolve(root, 'src/task-model.mjs')
const clientPath = resolve(root, 'src/client.js')
const outputPath = resolve(root, 'lib/client.js')

const stripExports = (source) => source
  .replace(/^export\s+(?=(const|function|async\s+function)\s)/gm, '')
  .replace(/^export\s*\{[\s\S]*?\}\s*from\s*['"][^'"]+['"]\s*;?\s*$/gm, '')

const pinClientSource = stripExports(await readFile(pinClientPath, 'utf8'))
const modelSource = stripExports(await readFile(modelPath, 'utf8'))
const rawClientSource = await readFile(clientPath, 'utf8')
const clientSource = stripExports(rawClientSource
  .replace(/^import\s*\{[\s\S]*?\}\s*from\s*['"]\.\/task-model\.mjs['"]\s*;?\s*/m, '')
  .replace(/^import\s*\{[\s\S]*?\}\s*from\s*['"]\.\/pin-client\.mjs['"]\s*;?\s*/m, ''))

const output = `window.__ModuleLoader__.load({\n  id: "dsh-better-tasks",\n  factory: requireModule => {\n${indent(pinClientSource, 4)}\n${indent(modelSource, 4)}\n${indent(clientSource, 4)}\n    return { name, inject, apply, contract }\n  },\n})\n`

await mkdir(dirname(outputPath), { recursive: true })
await writeFile(outputPath, output, 'utf8')

function indent(value, spaces) {
  const prefix = ' '.repeat(spaces)
  return value.split('\n').map((line) => line === '' ? '' : prefix + line).join('\n')
}
