import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import {
  FORK_SLUGS, INPUT_FORK_SLUGS, assertForkExternals, assertResolvedBuildLog, bareSpecifiers,
  compareModuleEdges, parseArgs, verifyForkExternals, verifyForks,
} from '../scripts/verify-fork-externals.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const verifier = fileURLToPath(new URL('../scripts/verify-fork-externals.mjs', import.meta.url))

async function fixture(t, slugs = FORK_SLUGS) {
  const dir = await mkdtemp(join(root, '.fork-externals-test-'))
  t.after(async () => {
    // Only remove this test's unique, verified workspace child, never caller paths.
    assert.equal(dirname(resolve(dir)), resolve(root))
    assert.ok(resolve(dir).startsWith(join(resolve(root), '.fork-externals-test-')))
    await rm(dir, { recursive: true, force: true })
  })
  const forkDir = join(dir, 'forks')
  const officialDir = join(dir, 'official')
  for (const base of [forkDir, officialDir]) {
    for (const slug of slugs) {
      await mkdir(join(base, slug, 'lib'), { recursive: true })
      await writeFile(join(base, slug, 'lib', 'client.js'), 'require("react");\n')
    }
  }
  return { dir, forkDir, officialDir }
}

function cli(args) {
  const result = spawnSync(process.execPath, [verifier, ...args], { encoding: 'utf8', timeout: 20_000 })
  if (result.error) throw result.error
  return result
}

test('AST extraction covers all supported runtime edge spellings and deduplicates', () => {
  const code = [
    'import "side-effect";',
    'import value from "static-import";',
    'export { value } from "named-re-export";',
    'export * from "star-re-export";',
    'import("dynamic-import");',
    'require("react"); require("react");',
    'require.async("loader-async");',
    'require["async"]("loader-computed-async");',
    'require(`template-literal`);',
    'require("cl\\u0073x");',
    'function lazy() { return require("nested"); }',
  ].join('\n')
  assert.deepEqual(bareSpecifiers(code), [
    'clsx', 'dynamic-import', 'loader-async', 'loader-computed-async',
    'named-re-export', 'nested', 'react', 'side-effect', 'star-re-export',
    'static-import', 'template-literal',
  ])
})

test('comments, strings, template text and unrelated object methods are not imports', () => {
  const code = [
    '// require("comment")',
    '/* import "comment-side-effect"; require.async("comment-async"); */',
    'const text = \'require("string") from "also-string"\';',
    'const template = `import("template-text")`;',
    'const regex = /require\\("regex-text"\\)/;',
    'someObject.require("not-loader");',
    'someObject.async("not-loader-either");',
    'require /* real comment */ ("react");',
  ].join('\n')
  assert.deepEqual(bareSpecifiers(code), ['react'])
})

test('real imports in template interpolations are still inspected', () => {
  assert.deepEqual(bareSpecifiers('const text = `${require("real-edge")}`;'), ['real-edge'])
})

test('relative chunks, absolute paths and protocol ids are not bare specifiers', () => {
  assert.deepEqual(bareSpecifiers([
    'require("./chunk.js"); require.async("../chunk.js");',
    'import "/absolute.js"; import("https://example.invalid/module.js");',
    'require("node:fs"); require("C:/absolute.js"); require("\\0virtual");',
    'require("@scope/package/subpath");',
  ].join('\n')), ['@scope/package/subpath'])
})

test('invalid JS and non-literal runtime requests fail closed', () => {
  assert.throws(() => bareSpecifiers('require('), /Cannot parse/)
  for (const code of ['require(name)', 'require.async(name)', 'import(name)', 'require()']) {
    assert.throws(() => bareSpecifiers(code), /non-literal runtime module request/)
  }
})

test('edge comparison catches the synthetic clsx regression and missing baseline modules', () => {
  const official = 'require("react"); require("react/jsx-runtime");'
  const broken = compareModuleEdges('require("react"); require("clsx");', official)
  assert.equal(broken.state, 'FAIL')
  assert.deepEqual(broken.extra, ['clsx'])
  assert.deepEqual(broken.missing, ['react/jsx-runtime'])
  assert.equal(broken.forkSha.length, 64)
  assert.equal(compareModuleEdges(`${official}\n// require("clsx")`, official).state, 'PASS')
})

test('side-effect imports and require.async cannot bypass edge comparison', () => {
  for (const edge of ['import "clsx";', 'require.async("clsx");']) {
    assert.deepEqual(compareModuleEdges(`require("react"); ${edge}`, 'require("react");').extra, ['clsx'])
  }
})

test('every UNRESOLVED_IMPORT warning is fatal regardless of format', () => {
  assert.doesNotThrow(() => assertResolvedBuildLog('build succeeded'))
  for (const log of [
    '[UNRESOLVED_IMPORT] Could not resolve \'clsx\'',
    '[UNRESOLVED_IMPORT] Could not resolve "clsx"',
    '[UNRESOLVED_IMPORT]\nCould not resolve "clsx"',
    'UNRESOLVED_IMPORT: unspecified dependency',
  ]) {
    assert.throws(() => assertResolvedBuildLog(log, 'questions'), /questions: UNRESOLVED_IMPORT/)
  }
})

test('arguments default to all forks and reject unknown slugs/options and missing values', () => {
  assert.deepEqual(parseArgs([]).slugs, FORK_SLUGS)
  assert.deepEqual(parseArgs(['ui-user-questions', '--fork-dir', 'candidate', '--official', 'baseline', '--json']), {
    asJson: true, slugs: ['ui-user-questions'], forkDir: 'candidate', officialDir: 'baseline',
  })
  for (const args of [
    ['typo'], ['--typo'], ['--fork-dir'], ['--official'], ['--fork-dir', '--json'],
    ['--fork-dir', ''], ['ui-layout', 'ui-layout'], ['--json', '--json'],
  ]) assert.throws(() => parseArgs(args))
  assert.throws(() => verifyForkExternals({ slugs: [] }), /At least one/)
  assert.throws(() => verifyForkExternals({ slugs: ['typo'] }), /Unknown fork/)
})

test('explicit candidate trees and release alias verify all three bundles', async t => {
  const options = await fixture(t)
  assert.equal(verifyForks, verifyForkExternals)
  const results = verifyForks(options)
  assert.equal(results.length, 3)
  assert.ok(results.every(result => result.state === 'PASS'))
  assert.equal(assertForkExternals('ui-layout', 'require("react");', options).state, 'PASS')
  assert.throws(() => assertForkExternals('ui-layout', 'require("clsx");', options), /extra: clsx; missing: react/)
})

test('input surface forks use the same strict edge gate without changing legacy defaults', async t => {
  const options = { ...await fixture(t, INPUT_FORK_SLUGS), slugs: INPUT_FORK_SLUGS }
  assert.deepEqual(parseArgs([...INPUT_FORK_SLUGS]).slugs, INPUT_FORK_SLUGS)
  assert.deepEqual(parseArgs([]).slugs, FORK_SLUGS)
  assert.ok(verifyForks(options).every(row => row.state === 'PASS'))
  await writeFile(join(options.forkDir, 'ui-conversation/lib/client.js'), 'require("react"); require("lexical");')
  const rows = verifyForks(options)
  assert.deepEqual(rows.find(row => row.slug === 'ui-conversation').extra, ['lexical'])
  assert.equal(rows.find(row => row.slug === 'ui-conversation').state, 'FAIL')
})

test('missing selected bundles fail instead of SKIP or zero-package PASS', async t => {
  const options = await fixture(t, ['ui-layout'])
  const results = verifyForks(options)
  assert.deepEqual(results.map(result => result.state), ['PASS', 'FAIL', 'FAIL'])
  assert.match(results[1].detail, /ENOENT/)
  assert.equal(verifyForks({ ...options, slugs: ['ui-layout'] })[0].state, 'PASS')
  const noBaseline = verifyForks({ ...options, officialDir: join(options.dir, 'missing-baseline') })
  assert.ok(noBaseline.every(result => result.state === 'FAIL'))
})

test('CLI verifies extracted bytes, not the staged working tree', async t => {
  const options = await fixture(t)
  await writeFile(join(options.forkDir, 'ui-user-questions/lib/client.js'), 'require("react"); require("clsx");')
  const result = cli(['--fork-dir', options.forkDir, '--official', options.officialDir, '--json'])
  assert.equal(result.status, 1, result.stderr)
  const rows = JSON.parse(result.stdout)
  assert.equal(rows.length, 3)
  assert.deepEqual(rows.find(row => row.slug === 'ui-user-questions').extra, ['clsx'])
})

test('CLI success and failure exit codes are fail closed', async t => {
  const options = await fixture(t, ['ui-layout'])
  const overrides = ['--fork-dir', options.forkDir, '--official', options.officialDir, '--json']
  assert.equal(cli(['ui-layout', ...overrides]).status, 0)
  assert.equal(cli(overrides).status, 1)
  const unknown = cli(['typo', ...overrides])
  assert.equal(unknown.status, 1)
  assert.match(unknown.stderr, /Unknown fork slug/)
  assert.equal(unknown.stdout, '')
})

test('importing the verifier does not run CLI or exit the importing process', () => {
  const url = new URL('../scripts/verify-fork-externals.mjs', import.meta.url).href
  const script = `process.argv = ['node', ${JSON.stringify(verifier)}, 'unknown-fork']; const m = await import(${JSON.stringify(url)} + '?import-only'); console.log(typeof m.verifyForks);`
  // Point argv[1] somewhere else: a library import must not consume its caller's
  // flags. The URL query also distinguishes this fresh module instance.
  const safeScript = script.replace(JSON.stringify(verifier), JSON.stringify(join(root, 'caller.mjs')))
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', safeScript], { encoding: 'utf8', timeout: 20_000 })
  if (result.error) throw result.error
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout.trim(), 'function')
  assert.equal(result.stderr, '')
})

test('build gates exact stamped bytes before publishing and leaves emit-patch unstaged', async () => {
  const source = await readFile(new URL('../scripts/build-forks-from-source.mjs', import.meta.url), 'utf8')
  const warningGate = source.indexOf('assertResolvedBuildLog(log, slug)')
  const artifactRead = source.indexOf("const built = await readFile(join(buildRoot")
  const edgeGate = source.indexOf('assertForkExternals(slug, stamped, { version: lock.version })')
  const publish = source.indexOf('await writeFile(join(root, `forks-${lock.version}`')
  assert.ok(warningGate !== -1 && warningGate < artifactRead)
  assert.ok(edgeGate > artifactRead && edgeGate < publish)
  const marker = '// ---------------------------------------------------------------- main'
  assert.ok(source.includes(marker))
  const calls = []
  await vm.runInNewContext(`(async () => { ${source.slice(source.indexOf(marker))} })()`, {
    flag: name => name === 'emit-patch',
    valueOf: () => 'ui-layout',
    stage: async () => calls.push('stage'),
    build: async () => calls.push('build'),
    emitPatch: async slug => calls.push(`emit:${slug}`),
    console: { log: () => {} },
  })
  assert.deepEqual(calls, ['emit:ui-layout'])
})
