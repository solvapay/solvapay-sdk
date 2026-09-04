/**
 * Fail if a generated drift path is missing `@generated` / `_comment`,
 * or if a committed file carries a generated marker but is not declared.
 *
 * Paths come from `contract/manifest/repo-paths.yaml` via `planClean` and
 * `externalGenerated`, so a newly listed artifact cannot silently skip this gate.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { REPO_ROOT } from '../shared/paths.js'
import { loadRepoPathsManifest } from '../shared/repo-paths.js'
import { hasGeneratedMarker, planClean, type CleanPlan } from './gen-clean.js'
import { isDirectRun, parseErrorResult, runScriptMain, type CliResult } from './lib/cli.js'

export interface MarkerIssue {
  rel: string
  reason: 'missing' | 'unmarked' | 'undeclared' | 'stale-exemption'
}

export interface MarkerExemption {
  pattern: string
  reason: string
}

export function markerExemptions(
  manifest: { markerExemptions: MarkerExemption[] } = loadRepoPathsManifest(),
): MarkerExemption[] {
  return manifest.markerExemptions
}

export function markerTargets(plan: CleanPlan, root: string): string[] {
  const files = plan.files.map(item => item.rel)
  const fromDirs: string[] = []
  for (const dir of plan.directories) {
    const abs = path.join(root, ...dir.rel.split('/'))
    if (!existsSync(abs) || !statSync(abs).isDirectory()) {
      fromDirs.push(dir.rel)
      continue
    }
    walkFiles(abs, dir.rel, fromDirs)
  }
  return [...files, ...fromDirs]
}

function walkFiles(abs: string, rel: string, out: string[]): void {
  for (const name of readdirSync(abs)) {
    const childAbs = path.join(abs, name)
    const childRel = `${rel}/${name}`
    if (statSync(childAbs).isDirectory()) {
      walkFiles(childAbs, childRel, out)
    } else {
      out.push(childRel)
    }
  }
}

export function checkGeneratedMarkers(
  rels: string[],
  root: string,
  readFile: (rel: string) => string | null = rel => {
    const abs = path.join(root, ...rel.split('/'))
    if (!existsSync(abs) || statSync(abs).isDirectory()) {
      return null
    }
    return readFileSync(abs, 'utf8')
  },
): MarkerIssue[] {
  const issues: MarkerIssue[] = []
  for (const rel of rels) {
    const contents = readFile(rel)
    if (contents === null) {
      issues.push({ rel, reason: 'missing' })
      continue
    }
    if (!hasGeneratedMarker(contents)) {
      issues.push({ rel, reason: 'unmarked' })
    }
  }
  return issues
}

export function matchExemption(pattern: string, rel: string): boolean {
  let rest = pattern
  let prefix = ''
  if (rest.startsWith('**/')) {
    prefix = '(?:.*/)?'
    rest = rest.slice(3)
  }
  const body = rest
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\0')
    .replace(/\*/g, '[^/]*')
    .replace(/\0/g, '.*')
  return new RegExp(`^${prefix}${body}$`).test(rel)
}

function isBinaryRel(rel: string): boolean {
  return rel.endsWith('.wasm')
}

function carriesInverseMarker(contents: string): boolean {
  return contents.includes('@generated') || contents.includes('auto-generated')
}

export interface UndeclaredMarkerOptions {
  declared: string[]
  exempt: MarkerExemption[]
  reader: (rel: string) => string
}

export function findUndeclaredMarkerFiles(
  files: string[],
  options: UndeclaredMarkerOptions,
): MarkerIssue[] {
  const declared = new Set(options.declared)
  const markerFiles: string[] = []
  for (const rel of files) {
    if (isBinaryRel(rel)) {
      continue
    }
    if (carriesInverseMarker(options.reader(rel))) {
      markerFiles.push(rel)
    }
  }

  const issues: MarkerIssue[] = []
  for (const exemption of options.exempt) {
    const matched = markerFiles.some(rel => matchExemption(exemption.pattern, rel))
    if (!matched) {
      issues.push({ rel: exemption.pattern, reason: 'stale-exemption' })
    }
  }
  for (const rel of markerFiles) {
    if (declared.has(rel)) {
      continue
    }
    if (options.exempt.some(item => matchExemption(item.pattern, rel))) {
      continue
    }
    issues.push({ rel, reason: 'undeclared' })
  }
  return issues
}

function gitLsFiles(root: string): string[] {
  const result = spawnSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    {
      cwd: root,
      encoding: 'utf8',
    },
  )
  if (result.status !== 0) {
    throw new Error(`git ls-files failed: ${result.stderr}`)
  }
  return result.stdout.split('\0').filter(rel => rel.length > 0)
}

export function runMarkerCheck(root: string = REPO_ROOT): CliResult {
  const plan = planClean()
  const rels = markerTargets(plan, root)
  const issues = checkGeneratedMarkers(rels, root)
  const declared = [
    ...rels,
    ...loadRepoPathsManifest().externalGenerated.flatMap(entry => entry.paths),
  ]
  const inverse = findUndeclaredMarkerFiles(gitLsFiles(root), {
    declared,
    exempt: markerExemptions(),
    reader: rel => {
      const abs = path.join(root, ...rel.split('/'))
      if (!existsSync(abs) || statSync(abs).isDirectory()) {
        return ''
      }
      return readFileSync(abs, 'utf8')
    },
  })
  const all = [...issues, ...inverse]
  if (all.length === 0) {
    return {
      exitCode: 0,
      stdout: `OK: @generated headers present (${rels.length} paths)\n`,
      stderr: '',
    }
  }
  const lines = all.map(issue => `  ${issue.reason}: ${issue.rel}`)
  return {
    exitCode: 1,
    stdout: '',
    stderr: `missing generated marker:\n${lines.join('\n')}\n`,
  }
}

export async function runCli(argv: string[]): Promise<CliResult> {
  if (argv.includes('--help') || argv.includes('-h')) {
    return parseErrorResult(
      new Error('Usage: pnpm exec tsx tools/codegen/check-generated-headers.ts'),
      '',
    )
  }
  if (argv.length > 0) {
    return parseErrorResult(new Error(`Unknown argument: ${argv[0]}`), '')
  }
  return runMarkerCheck()
}

if (isDirectRun(import.meta.url, process.argv[1])) {
  void runScriptMain(runCli)
}
