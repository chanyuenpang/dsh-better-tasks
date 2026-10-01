// Prove (or refute) that the npm-published client artifact and the copy the desktop
// app ships are the same program, differing only in build-time constants.
//
// The desktop app's packages were rebuilt locally (its embedded source paths read
// D:\develop\dsh-harness-windows-x64), while the npm tarballs came from CI on Linux
// (/home/runner/work/deepseek-harness/...). That rebuild also reseeded every CSS-module
// class-name hash. If those are the ONLY differences, then patching the npm tarball is a
// faithful way to build a fork for the desktop runtime, because each plugin bundle
// carries its own CSS text and its own class-name map -- the fork replaces the app's
// copy wholesale rather than cross-referencing it.
//
// Normalization, applied to both sides:
//   1. drop the `//#region \0dsh-css:<build path>` comment lines
//   2. drop the `const css... = "<css text>"` declarations
//   3. blank the class-name map values, which are pure seed-derived hashes
//   4. blank any remaining \0dsh-css:<path> occurrences
//
// usage: ELECTRON_RUN_AS_NODE=1 "<AppRoot>/DeepSeek Harness.exe" scripts/verify-app-baseline-equivalence.mjs [appRoot] [version]

import { readFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createTwoFilesPatch } from 'diff'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const appRoot = process.argv[2] ?? 'H:\\Program Files\\Deepseek'
const version = process.argv[3] ?? '0.2.0-rc.2'
const appDsh = `${appRoot.replaceAll('\\', '/')}/resources/app.asar/dsh/node_modules/@deepseek-ai`

const packages = {
  'ui-layout': 'dsh-client-ui-layout',
  'ui-workspace': 'dsh-client-ui-workspace',
  'ui-user-questions': 'dsh-client-ui-user-questions',
}

function normalize(source) {
  return source
    .split('\n')
    .filter((line) => !/^\s*\/\/#region \\0dsh-css:/.test(line))
    .filter((line) => !/^\s*const css(\$\d+)? = "/.test(line))
    // Class-name map entries, including single-hyphenated variants such as
    // "search-skeleton" and inline one-line maps.
    .map((line) => line.replace(/("(?:[A-Za-z0-9_-]+)": )"[^"]*"/g, '$1"<HASH>"'))
    .map((line) => line.replaceAll(/\\0dsh-css:[^ ]*/g, '\\0dsh-css:<PATH>'))
    .join('\n')
}

let failures = 0
for (const [slug, name] of Object.entries(packages)) {
  const npmText = await readFile(resolve(root, 'third_party', slug, version, 'package/lib/client.js'), 'utf8')
  let appText
  try {
    appText = await readFile(`${appDsh}/${name}/lib/client.js`, 'utf8')
  } catch (error) {
    console.log(`${slug}: app copy unreadable (${error.message})`)
    failures += 1
    continue
  }

  const left = normalize(npmText)
  const right = normalize(appText)
  if (left === right) {
    console.log(`EQUIVALENT  ${slug}: npm tarball and app.asar copy are the same program after normalizing CSS hashes and build paths`)
    continue
  }

  failures += 1
  const patch = createTwoFilesPatch(`npm/${slug}`, `app/${slug}`, left, right, '', '', { context: 1 })
  const changed = patch.split('\n').filter((line) => /^[+-]/.test(line) && !/^[+-]{3}/.test(line)).length
  console.log(`DIFFERENT   ${slug}: ${changed} changed lines remain after normalization`)
  console.log(patch.split('\n').slice(0, 60).join('\n'))
}

process.exit(failures === 0 ? 0 : 1)
