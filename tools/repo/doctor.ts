/**
 * Contributor toolchain doctor — reports which work tiers are possible locally.
 *
 *   pnpm preflight
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { isDirectRun, runScriptMain, type CliResult } from '../codegen/lib/cli.js'
import { lookupPath } from '../shared/repo-paths.js'

export type WorkTier = 'ts-only' | 'codegen' | 'parity'
export type CheckStatus = 'ok' | 'missing' | 'mismatch'

export interface ToolCheck {
  id: string
  label: string
  status: CheckStatus
  detail: string
  requiredFor: WorkTier[]
}

export interface WorkTiers {
  'ts-only': boolean
  codegen: boolean
  parity: boolean
}

export interface ProbeResult {
  present: boolean
  version?: string
  detail?: string
}

export type ToolProbe = (bin: string, args?: readonly string[]) => ProbeResult

export interface DoctorDeps {
  probe?: ToolProbe
  rustToolchainText?: string
  packageJsonText?: string
}

export interface DoctorResult {
  exitCode: number
  stdout: string
  stderr: string
  checks: ToolCheck[]
  tiers: WorkTiers
}

const TS_ONLY: WorkTier[] = ['ts-only', 'codegen', 'parity']
const CODEGEN: WorkTier[] = ['codegen', 'parity']
const PARITY: WorkTier[] = ['parity']

const MIN_NODE = { major: 18, minor: 17 }

function defaultProbe(bin: string, args: readonly string[] = ['--version']): ProbeResult {
  const ran = spawnSync(bin, [...args], { encoding: 'utf8' })
  if (ran.error !== undefined || ran.status !== 0) {
    return { present: false }
  }
  const text = `${ran.stdout}${ran.stderr}`.trim()
  return { present: true, version: text.split('\n')[0] }
}

export function pinnedRustChannel(
  text: string = readFileSync(lookupPath('rustToolchain'), 'utf8'),
): string {
  const match = /^channel\s*=\s*"([^"]+)"/m.exec(text)
  if (match?.[1] === undefined) {
    throw new Error('rust-toolchain.toml is missing a channel pin')
  }
  return match[1]
}

export function pinnedPnpmVersion(
  text: string = readFileSync(lookupPath('packageJson'), 'utf8'),
): string {
  const parsed: unknown = JSON.parse(text)
  if (typeof parsed !== 'object' || parsed === null || !('packageManager' in parsed)) {
    throw new Error('package.json is missing packageManager')
  }
  const raw = parsed.packageManager
  if (typeof raw !== 'string') {
    throw new Error('package.json packageManager must be a string')
  }
  const match = /^pnpm@(\d+\.\d+\.\d+)/.exec(raw)
  if (match?.[1] === undefined) {
    throw new Error(`unrecognized packageManager pin: ${raw}`)
  }
  return match[1]
}

function parseSemverPrefix(
  raw: string,
): { major: number; minor: number; patch: number } | undefined {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(raw)
  if (match?.[1] === undefined || match[2] === undefined || match[3] === undefined) {
    return undefined
  }
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) }
}

function nodeMeetsMinimum(version: string): boolean {
  const parsed = parseSemverPrefix(version)
  if (parsed === undefined) {
    return false
  }
  if (parsed.major !== MIN_NODE.major) {
    return parsed.major > MIN_NODE.major
  }
  return parsed.minor >= MIN_NODE.minor
}

function versionContains(haystack: string, needle: string): boolean {
  return haystack.includes(needle)
}

function checkFromProbe(
  id: string,
  label: string,
  requiredFor: WorkTier[],
  probed: ProbeResult,
  ok: (probed: ProbeResult) => { status: CheckStatus; detail: string },
): ToolCheck {
  if (!probed.present) {
    return { id, label, status: 'missing', detail: 'not found on PATH', requiredFor }
  }
  const judged = ok(probed)
  return { id, label, requiredFor, ...judged }
}

export function evaluateWorkTiers(checks: ToolCheck[]): WorkTiers {
  const ready = (tier: WorkTier): boolean =>
    checks.filter(check => check.requiredFor.includes(tier)).every(check => check.status === 'ok')
  return {
    'ts-only': ready('ts-only'),
    codegen: ready('codegen'),
    parity: ready('parity'),
  }
}

export function collectDoctorChecks(deps: DoctorDeps = {}): ToolCheck[] {
  const probe = deps.probe ?? defaultProbe
  const rustPin = pinnedRustChannel(deps.rustToolchainText)
  const pnpmPin = pinnedPnpmVersion(deps.packageJsonText)

  const node = checkFromProbe('node', 'node', TS_ONLY, probe('node'), probed => {
    const version = probed.version ?? ''
    if (!nodeMeetsMinimum(version)) {
      return {
        status: 'mismatch',
        detail: `${version} (need >= ${MIN_NODE.major}.${MIN_NODE.minor})`,
      }
    }
    return { status: 'ok', detail: `${version} (>= ${MIN_NODE.major}.${MIN_NODE.minor})` }
  })

  const pnpm = checkFromProbe('pnpm', 'pnpm', TS_ONLY, probe('pnpm'), probed => {
    const version = probed.version ?? ''
    if (!versionContains(version, pnpmPin)) {
      return { status: 'mismatch', detail: `${version} (packageManager pin ${pnpmPin})` }
    }
    return { status: 'ok', detail: `${version} (pin ${pnpmPin})` }
  })

  const cargo = checkFromProbe('cargo', 'cargo', CODEGEN, probe('cargo'), probed => {
    const version = probed.version ?? ''
    if (!versionContains(version, rustPin)) {
      return { status: 'mismatch', detail: `${version} (rust-toolchain.toml ${rustPin})` }
    }
    return { status: 'ok', detail: `${version} (pin ${rustPin})` }
  })

  const rustc = checkFromProbe('rustc', 'rustc', CODEGEN, probe('rustc'), probed => {
    const version = probed.version ?? ''
    if (!versionContains(version, rustPin)) {
      return { status: 'mismatch', detail: `${version} (rust-toolchain.toml ${rustPin})` }
    }
    return { status: 'ok', detail: `${version} (pin ${rustPin})` }
  })

  const python = checkFromProbe('python3', 'python3', PARITY, probe('python3'), probed => ({
    status: 'ok',
    detail: probed.version ?? 'ok',
  }))
  const maturin = checkFromProbe('maturin', 'maturin', PARITY, probe('maturin'), probed => ({
    status: 'ok',
    detail: probed.version ?? 'ok',
  }))
  const ruby = checkFromProbe('ruby', 'ruby', PARITY, probe('ruby'), probed => ({
    status: 'ok',
    detail: probed.version ?? 'ok',
  }))
  const rubyHeaders = rubyHeadersCheck(deps, ruby)
  const go = checkFromProbe('go', 'go', PARITY, probe('go', ['version']), probed => ({
    status: 'ok',
    detail: probed.version ?? 'ok',
  }))
  const wasmOpt = checkFromProbe(
    'wasm-opt',
    'wasm-opt (Binaryen)',
    PARITY,
    probe('wasm-opt'),
    probed => ({
      status: 'ok',
      detail: probed.version ?? 'ok',
    }),
  )

  return [node, pnpm, cargo, rustc, python, maturin, ruby, rubyHeaders, go, wasmOpt]
}

function rubyHeadersCheck(deps: DoctorDeps, ruby: ToolCheck): ToolCheck {
  if (ruby.status !== 'ok') {
    return {
      id: 'ruby-headers',
      label: 'ruby headers',
      status: 'missing',
      detail: 'ruby is required first',
      requiredFor: PARITY,
    }
  }
  const probe = deps.probe ?? defaultProbe
  const probed = probe('ruby', [
    '-rrbconfig',
    '-e',
    'print File.join(RbConfig::CONFIG["rubyhdrdir"], "ruby.h")',
  ])
  const headerPath = probed.version ?? probed.detail
  if (headerPath !== undefined && existsSync(headerPath)) {
    return {
      id: 'ruby-headers',
      label: 'ruby headers',
      status: 'ok',
      detail: headerPath,
      requiredFor: PARITY,
    }
  }
  return {
    id: 'ruby-headers',
    label: 'ruby headers',
    status: 'missing',
    detail: 'ruby.h not found (install ruby development headers)',
    requiredFor: PARITY,
  }
}

const TIER_LABEL: Record<WorkTier, string> = {
  'ts-only': 'TS-only (committed WASM)',
  codegen: 'codegen (pnpm gen)',
  parity: 'full multi-language parity',
}

export function formatDoctorReport(checks: ToolCheck[], tiers: WorkTiers): string {
  const toolLines = checks.map(check => {
    const mark = check.status === 'ok' ? 'ok' : check.status
    return `  ${check.label.padEnd(22)} ${mark.padEnd(9)} ${check.detail}`
  })
  const missingFor = (tier: WorkTier): string => {
    const missing = checks
      .filter(check => check.requiredFor.includes(tier) && check.status !== 'ok')
      .map(check => check.id)
    if (missing.length === 0) {
      return 'ready'
    }
    return `not ready (missing: ${missing.join(', ')})`
  }
  const tierLines = (Object.keys(TIER_LABEL) as WorkTier[]).map(tier => {
    const state = tiers[tier] ? 'ready' : missingFor(tier)
    return `  ${TIER_LABEL[tier].padEnd(32)} ${state}`
  })
  return [
    'SolvaPay SDK doctor',
    '',
    'Toolchain',
    ...toolLines,
    '',
    'Work tiers',
    ...tierLines,
    '',
  ].join('\n')
}

export function runDoctor(deps: DoctorDeps = {}): DoctorResult {
  const checks = collectDoctorChecks(deps)
  const tiers = evaluateWorkTiers(checks)
  const report = formatDoctorReport(checks, tiers)
  return {
    exitCode: tiers['ts-only'] ? 0 : 1,
    stdout: report,
    stderr: '',
    checks,
    tiers,
  }
}

export async function runCli(_argv: string[] = []): Promise<CliResult> {
  const result = runDoctor()
  return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr }
}

if (isDirectRun(import.meta.url, process.argv[1])) {
  void runScriptMain(runCli)
}
