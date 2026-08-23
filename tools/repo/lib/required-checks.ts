/**
 * Required-checks drift gate (Step 55-b).
 *
 * Expands `ci.yml` job `name:` templates across `strategy.matrix`, then
 * bidirectionally reconciles the resulting check names against
 * the required-checks YAML under `contract/`. A `notRequired` / `deferred` entry must
 * carry an allowed reason so gaps stay visible.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import { joinRel, lookupRel } from '../../shared/paths.js'

export const PERMITTED_REASONS = [
  'c-abi-smoke-only',
  'go-client-suite-only',
  'dispatch-only',
] as const

export type PermittedReason = (typeof PERMITTED_REASONS)[number]

export type RequiredCheckIssueKind =
  | 'missing-required'
  | 'stale-manifest'
  | 'matrix-drift'
  | 'invalid-reason'

export type RequiredCheckIssue = {
  kind: RequiredCheckIssueKind
  name?: string
  jobId?: string
  message: string
}

export type ManifestCheck = {
  name: string
  jobId: string
  gate: string
  required?: boolean
  reason?: string
  deferred?: string
}

export type RequiredChecksManifest = {
  schemaVersion: 1
  branch: string
  checks: ManifestCheck[]
}

export type WorkflowJob = {
  id: string
  name: string
  matrix?: Record<string, unknown>
}

const MATRIX_EXPR = /\$\{\{\s*matrix\.([A-Za-z0-9_.]+)\s*\}\}/g

export function isPermittedReason(reason: string): reason is PermittedReason {
  return (PERMITTED_REASONS as readonly string[]).includes(reason)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getPath(obj: unknown, dotted: string): unknown {
  let current: unknown = obj
  for (const part of dotted.split('.')) {
    if (!isPlainObject(current) || !(part in current)) return undefined
    current = current[part]
  }
  return current
}

export function interpolateMatrixName(template: string, combo: Record<string, unknown>): string {
  return template.replace(MATRIX_EXPR, (match, dotted: string) => {
    const value = getPath(combo, dotted)
    if (value === undefined || value === null) return match
    if (typeof value === 'object') return JSON.stringify(value)
    return String(value)
  })
}

export function expandMatrixCombinations(
  matrix: Record<string, unknown>,
): Record<string, unknown>[] {
  const include = Array.isArray(matrix.include) ? matrix.include.filter(isPlainObject) : []
  const exclude = Array.isArray(matrix.exclude) ? matrix.exclude.filter(isPlainObject) : []

  const axes = Object.entries(matrix).filter(
    ([key, value]) => key !== 'include' && key !== 'exclude' && Array.isArray(value),
  ) as [string, unknown[]][]

  let combos: Record<string, unknown>[] = [{}]
  for (const [key, values] of axes) {
    const next: Record<string, unknown>[] = []
    for (const combo of combos) {
      for (const value of values) {
        next.push({ ...combo, [key]: value })
      }
    }
    combos = next
  }

  if (axes.length === 0) {
    combos = include.map(item => ({ ...item }))
  } else {
    for (const extra of include) {
      combos.push({ ...extra })
    }
  }

  return combos.filter(combo => !exclude.some(rule => matchesExclude(combo, rule)))
}

function matchesExclude(combo: Record<string, unknown>, rule: Record<string, unknown>): boolean {
  return Object.entries(rule).every(([key, value]) => {
    const actual = combo[key]
    if (isPlainObject(actual) && isPlainObject(value)) {
      return Object.entries(value).every(([inner, innerVal]) => actual[inner] === innerVal)
    }
    return actual === value
  })
}

export function expandJobCheckNames(job: WorkflowJob): string[] {
  if (job.matrix === undefined) return [job.name]
  return expandMatrixCombinations(job.matrix).map(combo => interpolateMatrixName(job.name, combo))
}

function validateEntryReasons(entry: ManifestCheck, issues: RequiredCheckIssue[]): void {
  const required = entry.required !== false
  if (!required) {
    if (entry.reason === undefined || !isPermittedReason(entry.reason)) {
      issues.push({
        kind: 'invalid-reason',
        name: entry.name,
        jobId: entry.jobId,
        message: `notRequired check "${entry.name}" needs an allowed reason (got ${JSON.stringify(entry.reason)}; expected one of: ${PERMITTED_REASONS.join(', ')})`,
      })
    }
  }
  if (entry.deferred !== undefined && !isPermittedReason(entry.deferred)) {
    issues.push({
      kind: 'invalid-reason',
      name: entry.name,
      jobId: entry.jobId,
      message: `deferred check "${entry.name}" has reason "${entry.deferred}" which is not permitted (expected one of: ${PERMITTED_REASONS.join(', ')})`,
    })
  }
}

export function checkRequiredChecks(
  jobs: readonly WorkflowJob[],
  manifest: RequiredChecksManifest,
): RequiredCheckIssue[] {
  const issues: RequiredCheckIssue[] = []

  for (const entry of manifest.checks) {
    validateEntryReasons(entry, issues)
  }

  const expandedByJob = new Map<string, string[]>()
  const workflowNames = new Set<string>()
  for (const job of jobs) {
    const names = expandJobCheckNames(job)
    expandedByJob.set(job.id, names)
    for (const name of names) workflowNames.add(name)
  }

  const manifestByJob = new Map<string, string[]>()
  const manifestNames = new Set<string>()
  for (const entry of manifest.checks) {
    manifestNames.add(entry.name)
    const list = manifestByJob.get(entry.jobId) ?? []
    list.push(entry.name)
    manifestByJob.set(entry.jobId, list)
  }

  for (const job of jobs) {
    const expanded = expandedByJob.get(job.id) ?? []
    for (const name of expanded) {
      if (manifestNames.has(name)) continue
      issues.push({
        kind: 'missing-required',
        name,
        jobId: job.id,
        message: `ci.yml check "${name}" (job ${job.id}) is absent from the required-checks manifest and is not marked notRequired`,
      })
    }
  }

  for (const entry of manifest.checks) {
    if (workflowNames.has(entry.name)) continue
    issues.push({
      kind: 'stale-manifest',
      name: entry.name,
      jobId: entry.jobId,
      message: `manifest check "${entry.name}" has no matching ci.yml job name`,
    })
  }

  for (const job of jobs) {
    if (job.matrix === undefined) continue
    const expanded = new Set(expandedByJob.get(job.id) ?? [])
    const listed = new Set(manifestByJob.get(job.id) ?? [])
    if (expanded.size === listed.size && [...expanded].every(name => listed.has(name))) {
      continue
    }
    issues.push({
      kind: 'matrix-drift',
      jobId: job.id,
      message: `job ${job.id} matrix expands to ${expanded.size} check name(s) but the manifest lists ${listed.size} for that jobId`,
    })
  }

  return issues
}

export function formatRequiredChecksReport(issues: readonly RequiredCheckIssue[]): string {
  if (issues.length === 0) return 'required-checks: OK'
  const lines = issues.map(i => {
    const who = i.name ?? i.jobId ?? '?'
    return `  [${i.kind}] ${who}: ${i.message}`
  })
  return `required-checks: ${issues.length} issue(s)\n${lines.join('\n')}`
}

export function parseWorkflowJobs(yamlText: string): WorkflowJob[] {
  const raw: unknown = parseYaml(yamlText)
  if (!isPlainObject(raw) || !isPlainObject(raw.jobs)) {
    throw new Error('workflow YAML is missing a jobs: map')
  }
  const jobs: WorkflowJob[] = []
  for (const [id, value] of Object.entries(raw.jobs)) {
    if (!isPlainObject(value)) continue
    const name = typeof value.name === 'string' ? value.name : id
    const strategy = isPlainObject(value.strategy) ? value.strategy : undefined
    const matrix =
      strategy !== undefined && isPlainObject(strategy.matrix) ? strategy.matrix : undefined
    jobs.push({ id, name, matrix })
  }
  return jobs
}

export function parseRequiredChecksManifest(raw: unknown): RequiredChecksManifest {
  if (!isPlainObject(raw) || raw.schemaVersion !== 1 || typeof raw.branch !== 'string') {
    throw new Error('required-checks manifest must have schemaVersion: 1 and branch')
  }
  if (!Array.isArray(raw.checks)) {
    throw new Error('required-checks manifest is missing checks:')
  }
  const checks: ManifestCheck[] = []
  for (const entry of raw.checks) {
    if (
      !isPlainObject(entry) ||
      typeof entry.name !== 'string' ||
      typeof entry.jobId !== 'string' ||
      typeof entry.gate !== 'string'
    ) {
      throw new Error('required-checks entry must have name, jobId, and gate')
    }
    checks.push({
      name: entry.name,
      jobId: entry.jobId,
      gate: entry.gate,
      required: typeof entry.required === 'boolean' ? entry.required : undefined,
      reason: typeof entry.reason === 'string' ? entry.reason : undefined,
      deferred: typeof entry.deferred === 'string' ? entry.deferred : undefined,
    })
  }
  return { schemaVersion: 1, branch: raw.branch, checks }
}

export function loadRequiredChecksManifest(filePath: string): RequiredChecksManifest {
  return parseRequiredChecksManifest(parseYaml(readFileSync(filePath, 'utf8')))
}

export function requiredCheckNames(manifest: RequiredChecksManifest): string[] {
  return manifest.checks.filter(c => c.required !== false).map(c => c.name)
}

export function runRequiredChecks(repoRoot: string): RequiredCheckIssue[] {
  const workflowPath = path.join(repoRoot, '.github', 'workflows', 'ci.yml')
  const manifestPath = joinRel(repoRoot, lookupRel('requiredChecks'))
  const jobs = parseWorkflowJobs(readFileSync(workflowPath, 'utf8'))
  const manifest = loadRequiredChecksManifest(manifestPath)
  return checkRequiredChecks(jobs, manifest)
}

export function buildBranchProtectionPayload(manifest: RequiredChecksManifest): {
  strict: true
  contexts: string[]
} {
  return {
    strict: true,
    contexts: requiredCheckNames(manifest),
  }
}
