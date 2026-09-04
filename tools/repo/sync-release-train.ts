#!/usr/bin/env tsx
/**
 * Stamp `@solvapay/release-train` into Cargo / Python / Ruby manifests.
 * `--check` fails when any stamped file has drifted.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { joinRel, lookupRel, REPO_ROOT } from '../shared/paths.js'
import {
  collectReleaseTrainDrift,
  formatReleaseTrainDrift,
  readReleaseTrainVersion,
  RELEASE_TRAIN_CARGO_TOMLS,
  RELEASE_TRAIN_PYPROJECTS,
  RELEASE_TRAIN_RUBY_VERSIONS,
  stampPyprojectDependency,
  stampRubyVersion,
  stampTomlPackageVersion,
} from './lib/release-train.js'

function writeIfChanged(abs: string, next: string): void {
  const prev = readFileSync(abs, 'utf8')
  if (prev !== next) writeFileSync(abs, next)
}

function stamp(repoRoot: string, version: string): void {
  for (const rel of RELEASE_TRAIN_CARGO_TOMLS) {
    const abs = joinRel(repoRoot, rel)
    writeIfChanged(abs, stampTomlPackageVersion(readFileSync(abs, 'utf8'), version))
  }
  for (const rel of RELEASE_TRAIN_PYPROJECTS) {
    const abs = joinRel(repoRoot, rel)
    let text = stampTomlPackageVersion(readFileSync(abs, 'utf8'), version)
    if (rel === lookupRel('pythonMcpPyproject')) {
      text = stampPyprojectDependency(text, version)
    }
    writeIfChanged(abs, text)
  }
  for (const rel of RELEASE_TRAIN_RUBY_VERSIONS) {
    const abs = joinRel(repoRoot, rel)
    writeIfChanged(abs, stampRubyVersion(readFileSync(abs, 'utf8'), version))
  }
}

const check = process.argv.includes('--check')
const version = readReleaseTrainVersion(REPO_ROOT)

if (check) {
  const drift = collectReleaseTrainDrift(REPO_ROOT, version)
  if (drift.length > 0) {
    console.error(formatReleaseTrainDrift(drift))
    console.error(
      'Run `pnpm exec tsx tools/repo/sync-release-train.ts` to stamp the sentinel version.',
    )
    process.exit(1)
  }
  console.log(`release-train: OK ${version}`)
  process.exit(0)
}

stamp(REPO_ROOT, version)
const drift = collectReleaseTrainDrift(REPO_ROOT, version)
if (drift.length > 0) {
  console.error(formatReleaseTrainDrift(drift))
  process.exit(1)
}
console.log(`release-train: stamped ${version}`)
