/**
 * Fail if a generated drift path is missing `@generated` / `_comment`.
 *
 * Paths come from `contract/manifest/repo-paths.yaml` via `planClean`, so a
 * newly listed artifact (for example `tsGenerated`) cannot silently skip this gate.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { REPO_ROOT } from '../shared/paths.js'
import { hasGeneratedMarker, planClean, type CleanPlan } from './gen-clean.js'
import { isDirectRun, parseErrorResult, runScriptMain, type CliResult } from './lib/cli.js'

export interface MarkerIssue {
  rel: string
  reason: 'missing' | 'unmarked'
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

export function runMarkerCheck(root: string = REPO_ROOT): CliResult {
  const plan = planClean()
  const rels = markerTargets(plan, root)
  const issues = checkGeneratedMarkers(rels, root)
  if (issues.length === 0) {
    return {
      exitCode: 0,
      stdout: `OK: @generated headers present (${rels.length} paths)\n`,
      stderr: '',
    }
  }
  const lines = issues.map(issue => `  ${issue.reason}: ${issue.rel}`)
  return {
    exitCode: 1,
    stdout: '',
    stderr: `missing generated marker:\n${lines.join('\n')}\n`,
  }
}

export async function runCli(argv: string[]): Promise<CliResult> {
  if (argv.includes('--help') || argv.includes('-h')) {
    return parseErrorResult(new Error('Usage: pnpm exec tsx tools/codegen/check-generated-headers.ts'), '')
  }
  if (argv.length > 0) {
    return parseErrorResult(new Error(`Unknown argument: ${argv[0]}`), '')
  }
  return runMarkerCheck()
}

if (isDirectRun(import.meta.url, process.argv[1])) {
  void runScriptMain(runCli)
}
