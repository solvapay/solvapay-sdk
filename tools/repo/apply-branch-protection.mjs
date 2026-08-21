#!/usr/bin/env node
/**
 * Print (default) or apply (`--apply`) the GitHub `main` required-status-checks
 * payload derived from `contract/required-checks.yaml`.
 *
 * Print-only is the Step 55-b contract. `--apply` is maintainer-opt-in and is
 * never invoked from CI or this rewrite.
 *
 * Endpoint: PUT /repos/:owner/:repo/branches/main/protection/required_status_checks
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'

function findRepoRoot(startDir: string): string {
  let dir = path.resolve(startDir)
  while (true) {
    if (existsSync(path.join(dir, 'pnpm-workspace.yaml'))) {
      return dir
    }
    const parent = path.dirname(dir)
    if (parent === dir) {
      throw new Error(`Could not find repo root (pnpm-workspace.yaml) from ${startDir}`)
    }
    dir = parent
  }
}

const repoRoot = findRepoRoot(process.cwd())
const manifestPath = path.join(repoRoot, 'contract', 'required-checks.yaml')
const apply = process.argv.includes('--apply')

const raw = parseYaml(readFileSync(manifestPath, 'utf8'))
if (
  typeof raw !== 'object' ||
  raw === null ||
  raw.schemaVersion !== 1 ||
  typeof raw.branch !== 'string' ||
  !Array.isArray(raw.checks)
) {
  throw new Error(`invalid required-checks manifest at ${manifestPath}`)
}

const branch = raw.branch
const contexts = raw.checks
  .filter(entry => entry !== null && typeof entry === 'object' && entry.required !== false)
  .map(entry => {
    if (typeof entry.name !== 'string') {
      throw new Error('required-checks entry is missing name')
    }
    return entry.name
  })

const payload = {
  strict: true,
  contexts,
}

const remote = spawnSync('git', ['remote', 'get-url', 'origin'], {
  cwd: repoRoot,
  encoding: 'utf8',
})
const remoteUrl = remote.status === 0 ? remote.stdout.trim() : ''
const matched = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)(?:\.git)?$/)
const owner = matched?.[1] ?? 'solvapay'
const repo = matched?.[2] ?? 'solvapay-sdk'
const endpoint = `repos/${owner}/${repo}/branches/${branch}/protection/required_status_checks`

console.log(
  JSON.stringify(
    {
      method: 'PUT',
      endpoint,
      apply,
      payload,
    },
    null,
    2,
  ),
)

if (!apply) {
  process.exit(0)
}

const result = spawnSync('gh', ['api', '--method', 'PUT', endpoint, '--input', '-'], {
  cwd: repoRoot,
  encoding: 'utf8',
  input: JSON.stringify(payload),
  stdio: ['pipe', 'inherit', 'inherit'],
})
process.exit(result.status === null ? 1 : result.status)
