import { readFileSync } from 'node:fs'
import path from 'node:path'
import { internalPackageRel, joinRel, lookupRel, REPO_PATHS } from '../../shared/paths.js'

export const RELEASE_TRAIN_PACKAGE = '@solvapay/release-train'
export const RELEASE_TRAIN_PACKAGE_REL = `${internalPackageRel('release-train')}/package.json`

export const RELEASE_TRAIN_CARGO_TOMLS = [
  lookupRel('cargoExport'),
  lookupRel('cargoDto'),
  lookupRel('cargoCore'),
  lookupRel('cargoMcpCore'),
  lookupRel('cargoTransport'),
  lookupRel('cargoRustFacade'),
] as const

export const RELEASE_TRAIN_PYPROJECTS = [
  lookupRel('pythonPyproject'),
  lookupRel('pythonMcpPyproject'),
] as const

export const RELEASE_TRAIN_RUBY_VERSIONS = [
  lookupRel('rubyVersion'),
  lookupRel('rubyMcpVersion'),
] as const

const PACKAGE_VERSION_RE = /^version\s*=\s*"([^"]+)"/m
const RUBY_VERSION_RE = /VERSION\s*=\s*"([^"]+)"/

export function readReleaseTrainVersion(repoRoot: string): string {
  const raw: unknown = JSON.parse(
    readFileSync(joinRel(repoRoot, RELEASE_TRAIN_PACKAGE_REL), 'utf8'),
  )
  if (
    typeof raw !== 'object' ||
    raw === null ||
    !('name' in raw) ||
    !('version' in raw) ||
    raw.name !== RELEASE_TRAIN_PACKAGE ||
    typeof raw.version !== 'string'
  ) {
    throw new Error(
      `release-train: ${RELEASE_TRAIN_PACKAGE_REL} is not a valid sentinel package.json`,
    )
  }
  return raw.version
}

export function readTomlPackageVersion(text: string): string {
  const match = text.match(PACKAGE_VERSION_RE)
  if (!match?.[1]) {
    throw new Error('release-train: missing package version in toml')
  }
  return match[1]
}

export function readRubyVersion(text: string): string {
  const match = text.match(RUBY_VERSION_RE)
  if (!match?.[1]) {
    throw new Error('release-train: missing VERSION in ruby file')
  }
  return match[1]
}

export function stampTomlPackageVersion(text: string, version: string): string {
  if (!PACKAGE_VERSION_RE.test(text)) {
    throw new Error('release-train: cannot stamp missing package version')
  }
  let next = text.replace(PACKAGE_VERSION_RE, `version = "${version}"`)
  next = next.replace(
    /(solvapay-(?:export|dto|core|mcp-core|transport)\s*=\s*\{[^}]*?\bversion\s*=\s*")([^"]+)(")/g,
    `$1${version}$3`,
  )
  return next
}

export function stampRubyVersion(text: string, version: string): string {
  if (!RUBY_VERSION_RE.test(text)) {
    throw new Error('release-train: cannot stamp missing VERSION')
  }
  return text.replace(RUBY_VERSION_RE, `VERSION = "${version}"`)
}

export function stampPyprojectDependency(text: string, version: string): string {
  return text.replace(/("solvapay)(?:==[^"]+)?"/, `$1==${version}"`)
}

export type ReleaseTrainDrift = {
  path: string
  expected: string
  actual: string
}

export function collectReleaseTrainDrift(
  repoRoot: string,
  expected = readReleaseTrainVersion(repoRoot),
): ReleaseTrainDrift[] {
  const drift: ReleaseTrainDrift[] = []
  for (const rel of RELEASE_TRAIN_CARGO_TOMLS) {
    const actual = readTomlPackageVersion(readFileSync(joinRel(repoRoot, rel), 'utf8'))
    if (actual !== expected) drift.push({ path: rel, expected, actual })
  }
  for (const rel of RELEASE_TRAIN_PYPROJECTS) {
    const actual = readTomlPackageVersion(readFileSync(joinRel(repoRoot, rel), 'utf8'))
    if (actual !== expected) drift.push({ path: rel, expected, actual })
  }
  for (const rel of RELEASE_TRAIN_RUBY_VERSIONS) {
    const actual = readRubyVersion(readFileSync(joinRel(repoRoot, rel), 'utf8'))
    if (actual !== expected) drift.push({ path: rel, expected, actual })
  }
  return drift
}

export function formatReleaseTrainDrift(drift: readonly ReleaseTrainDrift[]): string {
  if (drift.length === 0) return 'release-train: OK'
  const lines = [
    `release-train: ${drift.length} manifest(s) drifted from sentinel ${drift[0]?.expected}`,
    ...drift.map(item => `  ${item.path}: ${item.actual} (expected ${item.expected})`),
  ]
  return lines.join('\n')
}

export function changesetTouchesReleaseTrain(contents: readonly string[]): boolean {
  return contents.some(
    text =>
      text.includes(`"${RELEASE_TRAIN_PACKAGE}"`) || text.includes(`'${RELEASE_TRAIN_PACKAGE}'`),
  )
}

export function prTouchesReleaseTrainSources(changedFiles: readonly string[]): boolean {
  const corePrefix = `${REPO_PATHS.dirs.core}/`
  const sdksPrefix = 'sdks/'
  const skipPrefixes = [
    `${REPO_PATHS.sdks.typescript}/`,
    `${REPO_PATHS.sdks['node-native']}/`,
    `${REPO_PATHS.sdks.wasm}/`,
  ]
  return changedFiles.some(file => {
    const posix = file.split(path.sep).join('/')
    if (posix.startsWith(corePrefix)) return true
    if (!posix.startsWith(sdksPrefix)) return false
    return skipPrefixes.every(prefix => !posix.startsWith(prefix))
  })
}
