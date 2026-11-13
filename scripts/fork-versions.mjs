// Resolve which dsh line a build/verify/pack run targets.
//
// The fork library is per-line by construction: the six client-UI forks replace
// app-owned modules, so a fork built from tag A is only valid against runtime A.
// Supporting a second machine on a different runtime therefore means supporting a
// second line, not relaxing a version check.
//
// Every script reads its version facts from here instead of assuming
// provenance/source.lock.json is the only line. Selection order:
//
//   1. --version <v>  (explicit)
//   2. DSH_FORK_VERSION environment variable
//   3. provenance/source.lock.json's version (the active/default line)
//
// provenance/versions.json is the registry of known lines; source.lock.json stays the
// active line's manifest and remains the default so existing workflows are unchanged.

import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** The six client-UI packages this project forks. */
export const slugs = ['ui-layout', 'ui-workspace', 'ui-user-questions', 'ui-input-trigger', 'ui-commands', 'ui-conversation']

/**
 * Read the multi-line registry.
 * @returns parsed provenance/versions.json, or null when the file is absent (pre-registry checkout).
 */
export function readRegistry() {
  try {
    return JSON.parse(readFileSync(join(root, 'provenance', 'versions.json'), 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

/**
 * Read the active line's manifest. Kept separate from the registry because
 * source.lock.json carries build-toolchain facts the registry does not repeat.
 * @returns parsed provenance/source.lock.json.
 */
export function readActiveLock() {
  return JSON.parse(readFileSync(join(root, 'provenance', 'source.lock.json'), 'utf8'))
}

/**
 * Pick the target version from argv/env/default.
 * @param argv - process arguments, defaults to process.argv.
 * @returns the requested version string, or null to mean "use the active lock as-is".
 */
export function requestedVersion(argv = process.argv) {
  const at = argv.indexOf('--version')
  if (at !== -1 && argv[at + 1] !== undefined) return argv[at + 1]
  const fromEnv = process.env.DSH_FORK_VERSION
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv
  return null
}

/**
 * Resolve the full fact set for one dsh line: the same shape as source.lock.json, so
 * callers never care whether the facts came from the active lock or the registry.
 * @param version - explicit version string, or null for the active line.
 * @returns { version, tag, commit, tarball, tarballSha256, vendoredTarball, title, profile, buildToolchain }
 */
export function resolveLine(version = null) {
  const active = readActiveLock()
  if (version === null || version === active.version) {
    return normalize(active, active.version)
  }
  const registry = readRegistry()
  const entry = registry?.versions?.[version]
  if (entry === undefined) {
    const known = registry === null ? '(registry missing)' : Object.keys(registry.versions ?? {}).join(', ')
    throw new Error(
      `dsh line ${version} is not registered in provenance/versions.json (known: ${known}). `
      + 'Add the line there (tag, commit, tarball, sha256) before building against it.',
    )
  }
  // Toolchain facts are per-line in principle; inherit the active line's values and let
  // the registry override any field it knows better.
  return normalize({ ...active, ...entry }, version)
}

/**
 * Fill derived fields and validate the invariants a build depends on.
 * @param raw - lock or registry entry.
 * @param version - the version this fact set describes.
 * @returns the normalized fact set.
 */
function normalize(raw, version) {
  const line = {
    ...raw,
    version,
    tag: raw.tag ?? `dsh-v${version}`,
    tarballSha256: raw.tarballSha256 ?? null,
    vendoredTarball: raw.vendoredTarball ?? `third_party/source/${raw.tag ?? `dsh-v${version}`}.tar.gz`,
  }
  if (!line.title) line.title = 'DeepSeek Harness'
  if (!line.profile) line.profile = 'official'
  return line
}

/**
 * Whether a line is buildable here (its vendored source tarball is present).
 * @param line - resolved line.
 * @returns true when third_party/source/<tag>.tar.gz exists.
 */
export function isVendored(line) {
  try {
    readFileSync(join(root, line.vendoredTarball))
    return true
  } catch {
    return false
  }
}
