import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  internalPackageRel,
  joinRel,
  lookupRel,
  REPO_PATHS,
  toolPackageRel,
} from '../../shared/paths.js'

export const RELEASE_TRAIN_PACKAGE = '@solvapay/release-train'
export const RELEASE_TRAIN_PACKAGE_REL = `${internalPackageRel('release-train')}/package.json`

export const RELEASE_TRAIN_FIXED_GROUP = [
  '@solvapay/core',
  '@solvapay/server',
  '@solvapay/mcp',
  '@solvapay/mcp-core',
  '@solvapay/server-native',
  '@solvapay/server-wasm',
  RELEASE_TRAIN_PACKAGE,
] as const

export const RELEASE_TRAIN_CARGO_TOMLS = [
  lookupRel('cargoExport'),
  lookupRel('cargoDto'),
  lookupRel('cargoCore'),
  lookupRel('cargoMcpCore'),
  lookupRel('cargoTransport'),
  lookupRel('cargoRustFacade'),
  lookupRel('cargoCapi'),
  lookupRel('cargoPythonBinding'),
  lookupRel('cargoNodeNative'),
  lookupRel('cargoWasm'),
  lookupRel('cargoGoWasm'),
  lookupRel('cargoRubyBinding'),
] as const

export const RELEASE_TRAIN_PYPROJECTS = [
  lookupRel('pythonPyproject'),
  lookupRel('pythonMcpPyproject'),
] as const

export const RELEASE_TRAIN_RUBY_VERSIONS = [
  lookupRel('rubyVersion'),
  lookupRel('rubyMcpVersion'),
] as const

export const RELEASE_TRAIN_GO_VERSION_TESTS = [
  'sdks/go/version_test.go',
  'sdks/go/version_skew_test.go',
] as const

/** Stamped into `@solvapay/init` because the published CLI does not ship the sentinel file. */
export const RELEASE_TRAIN_INIT_SCAFFOLD_VERSION = `${toolPackageRel('init')}/src/language/release-train-version.generated.ts`

const PACKAGE_VERSION_RE = /^version\s*=\s*"([^"]+)"/m
const RUBY_VERSION_RE = /VERSION\s*=\s*"([^"]+)"/
const INIT_SCAFFOLD_VERSION_RE = /export const RELEASE_TRAIN_VERSION = ['"]([^'"]*)['"]/

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
    typeof raw.version !== 'string' ||
    raw.version.length === 0
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

export function stampGoVersionTest(text: string, version: string): string {
  const next = text.replace(/"\d+\.\d+\.\d+"/g, `"${version}"`)
  if (readGoPinnedVersion(next) !== version) {
    throw new Error('release-train: cannot stamp Go version test')
  }
  return next
}

export function readGoPinnedVersion(text: string): string {
  const found = [...text.matchAll(/"(\d+\.\d+\.\d+)"/g)].map(match => match[1])
  if (found.length === 0 || found.some(value => value !== found[0])) {
    throw new Error('release-train: Go version test must pin exactly one x.y.z literal')
  }
  return found[0] ?? ''
}

export function readInitScaffoldVersion(text: string): string {
  const match = text.match(INIT_SCAFFOLD_VERSION_RE)
  if (!match?.[1]) {
    throw new Error('release-train: missing RELEASE_TRAIN_VERSION in init scaffold stamp')
  }
  return match[1]
}

export function stampInitScaffoldVersion(text: string, version: string): string {
  if (!INIT_SCAFFOLD_VERSION_RE.test(text)) {
    throw new Error('release-train: cannot stamp missing init scaffold version')
  }
  return text.replace(INIT_SCAFFOLD_VERSION_RE, `export const RELEASE_TRAIN_VERSION = '${version}'`)
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
  for (const rel of RELEASE_TRAIN_GO_VERSION_TESTS) {
    const actual = readGoPinnedVersion(readFileSync(joinRel(repoRoot, rel), 'utf8'))
    if (actual !== expected) drift.push({ path: rel, expected, actual })
  }
  const initScaffold = readInitScaffoldVersion(
    readFileSync(joinRel(repoRoot, RELEASE_TRAIN_INIT_SCAFFOLD_VERSION), 'utf8'),
  )
  if (initScaffold !== expected) {
    drift.push({ path: RELEASE_TRAIN_INIT_SCAFFOLD_VERSION, expected, actual: initScaffold })
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

const GROUP_MEMBER_RE = new RegExp(
  `['"](?:${RELEASE_TRAIN_FIXED_GROUP.filter(name => name !== RELEASE_TRAIN_PACKAGE)
    .map(name => name.replace('/', '\\/'))
    .join('|')})['"]`,
)

export function changesetTouchesFixedGroupMember(contents: readonly string[]): boolean {
  return contents.some(text => GROUP_MEMBER_RE.test(text))
}

export function prTouchesReleaseTrainSources(changedFiles: readonly string[]): boolean {
  const corePrefix = `${REPO_PATHS.dirs.core}/`
  const sdksPrefix = 'sdks/'
  const skipPrefixes = [
    `${REPO_PATHS.tsPackages.react}/`,
    `${REPO_PATHS.tsPackages.next}/`,
    `${REPO_PATHS.tsPackages.auth}/`,
    `${REPO_PATHS.tsPackages['react-supabase']}/`,
  ]
  return changedFiles.some(file => {
    const posix = file.split(path.sep).join('/')
    if (posix.startsWith(corePrefix)) return true
    if (!posix.startsWith(sdksPrefix)) return false
    return skipPrefixes.every(prefix => !posix.startsWith(prefix))
  })
}
