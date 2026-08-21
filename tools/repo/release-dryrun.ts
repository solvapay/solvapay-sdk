#!/usr/bin/env tsx
/**
 * Local end-to-end release dry-run (Step 55-c).
 *
 * Mirrors the `dry_run` path of publish.yml: stable-version + workspace-dep
 * + workflow-input gate, then the pre-publish chain, then `changeset status`
 * and `pnpm -r publish --dry-run` (no NPM_TOKEN).
 *
 * Usage: pnpm release:dryrun
 */

import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import { formatReleaseDryrunReport, runReleaseDryrunCheck } from './lib/release-dryrun.js'
import { REPO_ROOT } from '../shared/paths.js'

const issues = runReleaseDryrunCheck(REPO_ROOT)
if (issues.length > 0) {
  console.error(formatReleaseDryrunReport(issues))
  process.exit(1)
}
console.error(formatReleaseDryrunReport(issues))

const steps: Array<{ title: string; command: string; args: string[] }> = [
  { title: 'deps:check', command: 'pnpm', args: ['deps:check'] },
  { title: 'build:packages', command: 'pnpm', args: ['build:packages'] },
  { title: 'test', command: 'pnpm', args: ['test'] },
  { title: 'validate:fetch-runtime', command: 'pnpm', args: ['validate:fetch-runtime'] },
  {
    title: 'validate:workspace (Deno)',
    command: 'pnpm',
    args: ['--filter', '@example/supabase-edge-mcp', 'validate:workspace'],
  },
  { title: 'changeset status', command: 'pnpm', args: ['changeset', 'status'] },
  {
    title: 'pnpm -r publish --dry-run',
    command: 'pnpm',
    args: ['-r', 'publish', '--dry-run', '--no-git-checks'],
  },
]

function fail(step: string, result: SpawnSyncReturns<string>): void {
  const code = result.status ?? 1
  console.error(`release:dryrun failed at ${step} (exit ${code})`)
  process.exit(code)
}

for (const step of steps) {
  console.error(`\n=== ${step.title} ===`)
  const result = spawnSync(step.command, step.args, {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    encoding: 'utf8',
  })
  if (result.error) {
    console.error(result.error)
    fail(step.title, result)
  }
  if (result.status !== 0) fail(step.title, result)
}

console.error('\nrelease:dryrun complete')
