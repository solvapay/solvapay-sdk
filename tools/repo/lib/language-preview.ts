/**
 * Pure planning for `pnpm preview`: args, rehearsal versions, tokens, stamps.
 */

import {
  ecosystemVersion,
  parseSemver,
  RELEASE_TRAIN_LANGUAGES,
  type ReleaseEcosystem,
  type ReleaseTrainLanguage,
} from './release-channel.js'
import {
  RELEASE_TRAIN_CARGO_TOMLS,
  RELEASE_TRAIN_PYPROJECTS,
  RELEASE_TRAIN_RUBY_VERSIONS,
} from './release-train.js'
import { REPO_PATHS } from '../../shared/paths.js'
import type { SupportMatrix } from './support-matrix.js'

export const PREVIEW_LANGUAGES = RELEASE_TRAIN_LANGUAGES

export type PreviewLanguage = ReleaseTrainLanguage

export type PreviewStage = 'build' | 'gate' | 'publish' | 'smoke'

export const PYTHON_WHEEL_ARCHES = ['macos', 'linux', 'windows'] as const

export type PythonWheelArch = (typeof PYTHON_WHEEL_ARCHES)[number]

export const PYTHON_WHEEL_FAMILIES: Record<PythonWheelArch, readonly string[]> = {
  macos: ['macos-universal2'],
  linux: ['manylinux-x86_64', 'manylinux-aarch64', 'musllinux-x86_64', 'musllinux-aarch64'],
  windows: ['win_amd64', 'win_arm64'],
}

export const RUBY_PLATFORMS = [
  'x86_64-linux',
  'aarch64-linux',
  'x86_64-darwin',
  'arm64-darwin',
] as const

export const RUBY_GEM_FAMILIES: Record<PythonWheelArch, readonly string[]> = {
  macos: ['x86_64-darwin', 'arm64-darwin'],
  linux: ['x86_64-linux', 'aarch64-linux'],
  windows: [],
}

export type PreviewFlags = {
  only?: PreviewLanguage
  version?: string
  run?: number
  dryRun: boolean
  json: boolean
  bail: boolean
  zig: boolean
  acceptPartial: boolean
  allowMissing: string[]
  arch: PythonWheelArch[]
}

export type Coverage = 'native' | 'docker' | 'zig' | 'unavailable'

export type FamilyCoverage = {
  id: string
  coverage: Coverage
  reason: string
  ciJob: string
}

export type PreviewHost = {
  platform: string
  arch: string
}

type FamilyKind = 'python' | 'ruby' | 'nodeNative'
type CpuArch = 'arm64' | 'x64'
type FamilyOs = 'darwin' | 'linux' | 'win32'

type FamilyTarget = {
  id: string
  kind: FamilyKind
  os: FamilyOs
  arch: CpuArch | 'universal'
  libc: 'musl' | 'gnu' | null
  ciJob: string
}

const TOKEN_BY_LANGUAGE: Record<PreviewLanguage, string | undefined> = {
  rust: undefined,
  python: 'SOLVAPAY_TESTPYPI_TOKEN',
  ruby: 'GEM_HOST_API_KEY',
  go: 'SOLVAPAY_GO_DEPLOY_TOKEN',
}

const ECOSYSTEM_BY_LANGUAGE: Record<PreviewLanguage, ReleaseEcosystem> = {
  rust: 'cargo',
  python: 'python',
  ruby: 'ruby',
  go: 'go',
}

const STAMP_RELS: Record<PreviewLanguage, readonly string[]> = {
  rust: RELEASE_TRAIN_CARGO_TOMLS,
  python: RELEASE_TRAIN_PYPROJECTS,
  ruby: RELEASE_TRAIN_RUBY_VERSIONS,
  go: [],
}

const GO_PRODUCTION_MODULE = 'github.com/solvapay/solvapay-go'
const GO_REHEARSAL_MODULE = 'github.com/solvapay/solvapay-go-rehearsal'
const GO_MODULE_RE = /github\.com\/solvapay\/solvapay-go(?!-rehearsal)/g
const PYTHON_LOCK_RELS = [
  `${REPO_PATHS.sdks.python}/uv.lock`,
  `${REPO_PATHS.sdks.pythonMcp}/uv.lock`,
] as const
const RUBY_LOCK_RELS = [`${REPO_PATHS.sdks.ruby}/Gemfile.lock`] as const
const CARGO_LOCK_REL = 'Cargo.lock'
const RESTORE_RELS: Record<PreviewLanguage, readonly string[]> = {
  rust: [...RELEASE_TRAIN_CARGO_TOMLS, CARGO_LOCK_REL],
  python: [...RELEASE_TRAIN_PYPROJECTS, ...PYTHON_LOCK_RELS],
  ruby: [...RELEASE_TRAIN_RUBY_VERSIONS, ...RUBY_LOCK_RELS],
  go: [],
}

function isPreviewLanguage(value: string): value is PreviewLanguage {
  return (PREVIEW_LANGUAGES as readonly string[]).includes(value)
}

function isPythonWheelArch(value: string): value is PythonWheelArch {
  return (PYTHON_WHEEL_ARCHES as readonly string[]).includes(value)
}

function requireValue(flag: string, value: string | undefined): string {
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`)
  }
  return value
}

function parsePositiveInt(flag: string, raw: string): number {
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new Error(`${flag} must be a positive integer, got ${raw}`)
  }
  return Number(raw)
}

function parseAllowMissing(raw: string): string[] {
  return raw
    .split(',')
    .map(id => id.trim())
    .filter(id => id.length > 0)
}

export function parsePreviewArgs(argv: string[]): PreviewFlags {
  let only: PreviewLanguage | undefined
  let version: string | undefined
  let run: number | undefined
  let dryRun = false
  let json = false
  let bail = false
  let zig = false
  let acceptPartial = false
  const allowMissing: string[] = []
  const arch: PythonWheelArch[] = []

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--dry-run') {
      dryRun = true
      continue
    }
    if (arg === '--json') {
      json = true
      continue
    }
    if (arg === '--bail') {
      bail = true
      continue
    }
    if (arg === '--zig') {
      zig = true
      continue
    }
    if (arg === '--accept-partial') {
      acceptPartial = true
      continue
    }
    if (arg === '--only') {
      const next = requireValue('--only', argv[i + 1])
      if (!isPreviewLanguage(next)) {
        throw new Error(`unknown language '${next}'. Valid names: ${PREVIEW_LANGUAGES.join(', ')}`)
      }
      only = next
      i += 1
      continue
    }
    if (arg === '--version') {
      version = parseSemver(requireValue('--version', argv[i + 1]))
      i += 1
      continue
    }
    if (arg === '--run') {
      run = parsePositiveInt('--run', requireValue('--run', argv[i + 1]))
      i += 1
      continue
    }
    if (arg === '--allow-missing') {
      allowMissing.push(...parseAllowMissing(requireValue('--allow-missing', argv[i + 1])))
      i += 1
      continue
    }
    if (arg === '--arch') {
      const raw = requireValue('--arch', argv[i + 1])
      for (const item of parseAllowMissing(raw)) {
        if (!isPythonWheelArch(item)) {
          throw new Error(
            `unknown architecture '${item}'. Valid names: ${PYTHON_WHEEL_ARCHES.join(', ')}`,
          )
        }
        if (!arch.includes(item)) arch.push(item)
      }
      i += 1
      continue
    }
    throw new Error(`Unknown argument: ${arg}`)
  }

  return { only, version, run, dryRun, json, bail, zig, acceptPartial, allowMissing, arch }
}

export function defaultPreviewRunNumber(nowMs: number = Date.now()): number {
  return Math.floor(nowMs / 1000)
}

export function requiredPreviewToken(language: PreviewLanguage): string | undefined {
  return TOKEN_BY_LANGUAGE[language]
}

export function missingPreviewTokens(
  languages: readonly PreviewLanguage[],
  env: NodeJS.Dict<string>,
): string[] {
  const missing: string[] = []
  for (const language of languages) {
    const token = requiredPreviewToken(language)
    if (token === undefined) continue
    const value = env[token]
    if (value === undefined || value.length === 0) {
      missing.push(token)
    }
  }
  return missing
}

export function selectedPreviewLanguages(flags: PreviewFlags): PreviewLanguage[] {
  if (flags.only !== undefined) return [flags.only]
  return [...PREVIEW_LANGUAGES]
}

export function previewStampRels(language: PreviewLanguage): readonly string[] {
  return STAMP_RELS[language]
}

export function previewRestoreRels(language: PreviewLanguage): readonly string[] {
  return RESTORE_RELS[language]
}

function normalizeCpuArch(arch: string): CpuArch | null {
  if (arch === 'arm64' || arch === 'aarch64') return 'arm64'
  if (arch === 'x64' || arch === 'x86_64' || arch === 'amd64') return 'x64'
  return null
}

function pythonWheelTarget(wheel: SupportMatrix['python']['wheels'][number]): FamilyTarget {
  const id = wheel.id
  if (id.startsWith('win_') || (wheel.os ?? '').startsWith('windows')) {
    return {
      id,
      kind: 'python',
      os: 'win32',
      arch: id.includes('arm') ? 'arm64' : 'x64',
      libc: null,
      ciJob: 'publish-python.yml',
    }
  }
  if (id === 'macos-universal2' || (wheel.target ?? '').includes('apple-darwin')) {
    return {
      id,
      kind: 'python',
      os: 'darwin',
      arch: 'universal',
      libc: null,
      ciJob: 'publish-python.yml',
    }
  }
  return {
    id,
    kind: 'python',
    os: 'linux',
    arch: id.includes('aarch64') || id.includes('arm64') ? 'arm64' : 'x64',
    libc: id.includes('musl') ? 'musl' : 'gnu',
    ciJob: 'publish-python.yml',
  }
}

function rubyGemTarget(gem: SupportMatrix['ruby']['gems'][number]): FamilyTarget {
  const id = gem.id
  const darwin = id.endsWith('-darwin')
  return {
    id,
    kind: 'ruby',
    os: darwin ? 'darwin' : 'linux',
    arch: id.startsWith('arm64') || id.startsWith('aarch64') ? 'arm64' : 'x64',
    libc: darwin ? null : 'gnu',
    ciJob: 'publish-ruby.yml',
  }
}

function nodeNativeTarget(target: SupportMatrix['nodeNative']['targets'][number]): FamilyTarget {
  const arch = normalizeCpuArch(target.arch)
  if (arch === null) {
    throw new Error(`support-matrix: unsupported nodeNative arch '${target.arch}'`)
  }
  if (target.platform !== 'darwin' && target.platform !== 'linux' && target.platform !== 'win32') {
    throw new Error(`support-matrix: unsupported nodeNative platform '${target.platform}'`)
  }
  return {
    id: target.dir,
    kind: 'nodeNative',
    os: target.platform,
    arch,
    libc: target.libc === 'musl' ? 'musl' : target.libc === 'glibc' ? 'gnu' : null,
    ciJob: 'ci.yml',
  }
}

function familyTargets(matrix: SupportMatrix): FamilyTarget[] {
  return [
    ...matrix.python.wheels.map(pythonWheelTarget),
    ...matrix.ruby.gems.map(rubyGemTarget),
    ...matrix.nodeNative.targets.map(nodeNativeTarget),
  ]
}

function classifyFamily(target: FamilyTarget, host: PreviewHost): Omit<FamilyCoverage, 'id'> {
  const hostArch = normalizeCpuArch(host.arch)
  const hostOs = host.platform

  if (target.kind === 'ruby' && target.os === 'darwin') {
    return {
      coverage: 'docker',
      reason: 'Darwin gem via rb-sys-dock (same path as CI)',
      ciJob: target.ciJob,
    }
  }
  if (target.os === 'win32' && hostOs !== 'win32') {
    return {
      coverage: 'unavailable',
      reason: 'no Windows toolchain',
      ciJob: target.ciJob,
    }
  }
  if (target.os === 'darwin' && hostOs !== 'darwin') {
    return {
      coverage: 'unavailable',
      reason: 'needs a macOS host',
      ciJob: target.ciJob,
    }
  }
  if (target.os === 'darwin' && target.arch !== 'universal' && target.arch !== hostArch) {
    return {
      coverage: 'unavailable',
      reason:
        target.arch === 'x64'
          ? 'needs an Intel host; CI uses macos-15-intel'
          : 'needs an Apple Silicon host',
      ciJob: target.ciJob,
    }
  }
  if (
    target.os === 'linux' &&
    target.libc === 'musl' &&
    target.arch === 'x64' &&
    hostOs === 'darwin' &&
    hostArch === 'arm64'
  ) {
    return {
      coverage: 'zig',
      reason: "Docker Desktop's Rosetta cannot run musl amd64 images",
      ciJob: target.ciJob,
    }
  }
  if (target.os === 'linux' && hostOs !== 'linux') {
    return {
      coverage: 'docker',
      reason: 'Linux artifact via Docker',
      ciJob: target.ciJob,
    }
  }
  if (target.os === 'linux' && hostOs === 'linux' && target.arch !== hostArch) {
    return {
      coverage: 'docker',
      reason: 'cross-arch Linux artifact via Docker',
      ciJob: target.ciJob,
    }
  }
  return {
    coverage: 'native',
    reason: 'host can build this family natively',
    ciJob: target.ciJob,
  }
}

export function hostCoverage(matrix: SupportMatrix, host: PreviewHost): FamilyCoverage[] {
  return familyTargets(matrix).map(target => ({
    id: target.id,
    ...classifyFamily(target, host),
  }))
}

export function previewLanguageFamilyIds(
  matrix: SupportMatrix,
  languages: readonly PreviewLanguage[],
): Set<string> {
  const ids = new Set<string>()
  if (languages.includes('python')) {
    for (const wheel of matrix.python.wheels) ids.add(wheel.id)
  }
  if (languages.includes('ruby')) {
    for (const gem of matrix.ruby.gems) ids.add(gem.id)
  }
  return ids
}

export function uncoveredHostFamilies(
  coverage: readonly FamilyCoverage[],
  relevantIds: ReadonlySet<string>,
  built: ReadonlySet<string>,
): FamilyCoverage[] {
  return coverage.filter(row => relevantIds.has(row.id) && !built.has(row.id))
}

export function coverageReportLines(
  coverage: readonly FamilyCoverage[],
  relevantIds: ReadonlySet<string>,
  built: ReadonlySet<string>,
): string[] {
  const relevant = coverage.filter(row => relevantIds.has(row.id))
  const uncovered = uncoveredHostFamilies(coverage, relevantIds, built)
  const builtCount = relevant.filter(row => built.has(row.id)).length
  const lines = [`preview coverage: built ${builtCount}/${relevant.length}`]
  for (const row of uncovered) {
    lines.push(`  ${row.id}: ${row.coverage} — ${row.reason} (CI: ${row.ciJob})`)
  }
  return lines
}

export function pythonAllowMissingForArches(arches: readonly PythonWheelArch[]): string[] {
  if (arches.length === 0) return []
  const keep = new Set(arches.flatMap(arch => [...PYTHON_WHEEL_FAMILIES[arch]]))
  return Object.values(PYTHON_WHEEL_FAMILIES)
    .flat()
    .filter(id => !keep.has(id))
}

export function selectedPythonArches(flags: PreviewFlags): PythonWheelArch[] {
  if (flags.arch.length > 0) return [...flags.arch]
  return [...PYTHON_WHEEL_ARCHES]
}

export function rubyAllowMissingForArches(arches: readonly PythonWheelArch[]): string[] {
  if (arches.length === 0) return []
  const keep = new Set(arches.flatMap(arch => [...RUBY_GEM_FAMILIES[arch]]))
  return Object.values(RUBY_GEM_FAMILIES)
    .flat()
    .filter(id => !keep.has(id))
}

export function rubyPlatformsForArches(arches: readonly PythonWheelArch[]): string[] {
  const selected = new Set(
    (arches.length > 0 ? arches : PYTHON_WHEEL_ARCHES).flatMap(arch => [
      ...RUBY_GEM_FAMILIES[arch],
    ]),
  )
  return RUBY_PLATFORMS.filter(platform => selected.has(platform))
}

export function previewStages(dryRun: boolean): PreviewStage[] {
  if (dryRun) return ['build', 'gate']
  return ['build', 'gate', 'publish', 'smoke']
}

export function previewLanguageVersions(
  baseVersion: string,
  runNumber: number,
): Record<PreviewLanguage, string> {
  const versions = {} as Record<PreviewLanguage, string>
  for (const language of PREVIEW_LANGUAGES) {
    versions[language] = ecosystemVersion(
      baseVersion,
      'rehearsal',
      ECOSYSTEM_BY_LANGUAGE[language],
      runNumber,
    )
  }
  return versions
}

export type PreviewPlan = {
  languages: PreviewLanguage[]
  versions: Record<PreviewLanguage, string>
  run: number
  dryRun: boolean
  zig: boolean
  allowMissing: string[]
  arch: PythonWheelArch[]
  stages: PreviewStage[]
  stampRels: string[]
  requiredTokens: string[]
}

export function previewPlan(flags: PreviewFlags, baseVersion: string): PreviewPlan {
  const run = flags.run ?? defaultPreviewRunNumber()
  const languages = selectedPreviewLanguages(flags)
  const stampRels = [...new Set(languages.flatMap(language => [...previewStampRels(language)]))]
  const requiredTokens = [
    ...new Set(
      languages
        .map(language => requiredPreviewToken(language))
        .filter((token): token is string => token !== undefined),
    ),
  ]
  return {
    languages,
    versions: previewLanguageVersions(baseVersion, run),
    run,
    dryRun: flags.dryRun,
    zig: flags.zig,
    allowMissing: [...flags.allowMissing],
    arch: [...flags.arch],
    stages: previewStages(flags.dryRun),
    stampRels,
    requiredTokens,
  }
}

export function rewriteGoRehearsalImports(source: string): string {
  return source.replace(GO_MODULE_RE, GO_REHEARSAL_MODULE)
}

export function goProductionModulePath(): string {
  return GO_PRODUCTION_MODULE
}

export function goRehearsalModulePath(): string {
  return GO_REHEARSAL_MODULE
}
