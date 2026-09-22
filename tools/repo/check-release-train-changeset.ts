#!/usr/bin/env tsx
/**
 * PR gate: changes under core/** or grouped sdks/** need a
 * `@solvapay/release-train` changeset. Direct targets of fixed-group
 * packages are rejected.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { CHANGESET_DIR, REPO_ROOT } from '../shared/paths.js'
import {
  changesetTouchesFixedGroupMember,
  changesetTouchesReleaseTrain,
  prTouchesReleaseTrainSources,
} from './lib/release-train.js'

function fetchPrBase(base: string): void {
  const gitDir = execFileSync('git', ['rev-parse', '--git-dir'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  }).trim()
  const shallowMarker = path.isAbsolute(gitDir)
    ? path.join(gitDir, 'shallow')
    : path.join(REPO_ROOT, gitDir, 'shallow')
  if (existsSync(shallowMarker)) {
    execFileSync('git', ['fetch', '--unshallow', '--no-tags', 'origin'], {
      cwd: REPO_ROOT,
      stdio: 'inherit',
    })
  }
  execFileSync('git', ['fetch', '--no-tags', 'origin', base], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  })
}

function changedFiles(): string[] {
  const base = process.env.GITHUB_BASE_REF
  if (base) {
    fetchPrBase(base)
    const spec = `origin/${base}...HEAD`
    const out = execFileSync('git', ['diff', '--name-only', spec], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    })
    return out
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
  }
  const out = execFileSync('git', ['diff', '--name-only', 'HEAD'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  })
  const staged = execFileSync('git', ['diff', '--name-only', '--cached'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  })
  return [
    ...new Set(
      [...out.split('\n'), ...staged.split('\n')].map(line => line.trim()).filter(Boolean),
    ),
  ]
}

function changesetBodies(): string[] {
  return readdirSync(CHANGESET_DIR)
    .filter(name => name.endsWith('.md') && name !== 'README.md')
    .map(name => readFileSync(path.join(CHANGESET_DIR, name), 'utf8'))
}

const files = changedFiles()
const bodies = changesetBodies()
if (changesetTouchesFixedGroupMember(bodies)) {
  console.error(
    'release-train changeset: HARD FAIL — a changeset names a fixed-group package directly.',
  )
  console.error(
    'Target @solvapay/release-train instead; the fixed group fans that bump to core, server, mcp, mcp-core, server-native, and server-wasm.',
  )
  process.exit(1)
}

if (!prTouchesReleaseTrainSources(files)) {
  console.log('release-train changeset: OK (no train sources in the diff)')
  process.exit(0)
}

if (changesetTouchesReleaseTrain(bodies)) {
  console.log('release-train changeset: OK')
  process.exit(0)
}

console.error(
  'release-train changeset: HARD FAIL — this PR touches core/ or a grouped SDK surface but has no "@solvapay/release-train" changeset.',
)
console.error('Add one with `pnpm changeset` so the lockstep version moves with the code.')
process.exit(1)
