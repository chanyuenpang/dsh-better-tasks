// Compare two built DSH client-plugin bundles for behavioural equivalence.
//
// A client bundle embeds build-time constants that legitimately differ between two
// correct builds of the same sources. Two upstream build routes exist for the same
// package: the CI route compiles `src/` to `lib/types/*.js` with tsc and bundles that
// intermediate (region labels read `lib/types/...`, tsc drops PURE annotations), while
// a standalone route bundles `src/` directly (region labels read `src/...`, PURE
// annotations survive). Class-name hashes are seed-derived, and the build path is baked
// into the CSS region comments.
//
// Normalization applied to both sides, so only program content is compared:
//   1. drop every `//#region` / `//#endregion` line (carries route and path only)
//   2. drop the `const css... = "<css text>"` declarations
//   3. blank class-name map values (pure seed-derived hashes)
//   4. strip `/* @__PURE__ */` annotations
//   5. sort each contiguous run of `let <id> = require("...");` lines
//
// usage: node scripts/compare-client-bundles.mjs <left.js> <right.js>

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createTwoFilesPatch } from 'diff'

const [leftArg, rightArg] = process.argv.slice(2)
if (!leftArg || !rightArg) {
  console.error('usage: node scripts/compare-client-bundles.mjs <left.js> <right.js>')
  process.exit(2)
}

const REQUIRE_LINE = /^\s*let [A-Za-z0-9_$]+ = require\("/
const REGION_LINE = /^\s*\/\/#(end)?region\b/

export function normalizeClientBundle(source) {
  const lines = source
    .split('\n')
    .filter((line) => !REGION_LINE.test(line))
    .filter((line) => !/^\s*const css(\$\d+)? = "/.test(line))
    .map((line) => line.replace(/("(?:[A-Za-z0-9_-]+)": )"[^"]*"/g, '$1"<HASH>"'))
    .map((line) => line.replaceAll('/* @__PURE__ */ ', ''))
    .map((line) => line.replaceAll(/\\0dsh-css:[^ ]*/g, '\\0dsh-css:<PATH>'))

  // Require bindings are declarations, so their order carries no meaning. Sort each
  // contiguous run so a different resolution order does not read as a difference.
  const out = []
  for (let i = 0; i < lines.length;) {
    if (!REQUIRE_LINE.test(lines[i])) { out.push(lines[i++]); continue }
    let end = i
    while (end < lines.length && REQUIRE_LINE.test(lines[end])) end++
    out.push(...lines.slice(i, end).sort())
    i = end
  }
  return out.join('\n')
}

const left = normalizeClientBundle(await readFile(resolve(leftArg), 'utf8'))
const right = normalizeClientBundle(await readFile(resolve(rightArg), 'utf8'))

if (left === right) {
  console.log(`EQUIVALENT  ${leftArg}  ==  ${rightArg}`)
  process.exit(0)
}

const patch = createTwoFilesPatch(leftArg, rightArg, left, right, '', '', { context: 2 })
const changed = patch.split('\n').filter((line) => /^[+-]/.test(line) && !/^[+-]{3}/.test(line)).length
console.log(`DIFFERENT   ${changed} changed lines`)
console.log(patch.split('\n').slice(0, 120).join('\n'))
process.exit(1)
