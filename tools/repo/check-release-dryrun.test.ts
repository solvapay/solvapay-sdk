/**
 * Step 55-c — release dry-run gate unit tests (RED→GREEN).
 *
 * Fixture cases prove the checker fails on (1) a pre-release version on a
 * publishable package, (2) a workspace:* dep that is not in the publish batch,
 * and (3) a publish workflow with no dry-run default. The live tree's six
 * publish workflows are checked in the last test — that assertion is the RED
 * that drives adding `dry_run` to publish.yml / publish-preview.yml.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  PUBLISH_WORKFLOW_FILES,
  UNPUBLISHED_DEP_ALLOWLIST,
  checkReleaseDryrun,
  formatReleaseDryrunReport,
  runReleaseDryrunCheck,
  type PublishWorkflowDoc,
  type RegistryProbe,
  type WorkspacePackage,
} from './lib/release-dryrun.js'
import { WORKFLOWS_DIR, REPO_ROOT } from '../shared/paths.js'

const pkg = (
  name: string,
  version: string,
  extra: Partial<WorkspacePackage> = {},
): WorkspacePackage => ({ name, version, ...extra })

const workflow = (fileName: string, yaml: string): PublishWorkflowDoc => ({ fileName, yaml })

const DRY_RUN_WORKFLOW = `
on:
  workflow_dispatch:
    inputs:
      dry_run:
        type: boolean
        default: true
`

const PUBLISH_FLAG_WORKFLOW = `
on:
  workflow_dispatch:
    inputs:
      publish_to_crates_io:
        type: boolean
        default: false
`

describe('release-dryrun fixtures', () => {
  it('fails when a publishable package has a pre-release version', async () => {
    const issues = await checkReleaseDryrun({
      packages: [pkg('@solvapay/server', '2.1.0'), pkg('@solvapay/core', '1.0.8-preview.10')],
      changesetIgnore: ['@example/*'],
      workflows: [workflow('publish.yml', DRY_RUN_WORKFLOW)],
    })
    expect(
      issues.some(i => i.kind === 'prerelease-version' && i.packageName === '@solvapay/core'),
    ).toBe(true)
    expect(formatReleaseDryrunReport(issues)).toMatch(/1\.0\.8-preview\.10/)
  })

  it('fails when a workspace:* dep does not resolve within the publish batch', async () => {
    const issues = await checkReleaseDryrun({
      packages: [
        pkg('@solvapay/server', '2.1.0', {
          dependencies: { '@solvapay/core': 'workspace:*' },
        }),
        pkg('@solvapay/test-utils', '0.0.0', { private: true }),
      ],
      changesetIgnore: ['@solvapay/test-utils'],
      workflows: [workflow('publish.yml', DRY_RUN_WORKFLOW)],
    })
    expect(
      issues.some(
        i =>
          i.kind === 'unresolved-workspace-dep' &&
          i.packageName === '@solvapay/server' &&
          i.dependencyName === '@solvapay/core',
      ),
    ).toBe(true)
    expect(formatReleaseDryrunReport(issues)).toMatch(/@solvapay\/core/)
  })

  it('passes when workspace:* and workspace:^ deps resolve to a publishable sibling', async () => {
    const issues = await checkReleaseDryrun({
      packages: [
        pkg('@solvapay/server', '2.1.0', {
          dependencies: { '@solvapay/core': 'workspace:*' },
          peerDependencies: { '@solvapay/auth': 'workspace:^' },
          optionalDependencies: { '@solvapay/server-native': 'workspace:*' },
        }),
        pkg('@solvapay/core', '1.3.0'),
        pkg('@solvapay/auth', '1.1.0'),
        pkg('@solvapay/server-native', '0.1.0'),
      ],
      changesetIgnore: ['@example/*'],
      workflows: [workflow('publish.yml', DRY_RUN_WORKFLOW)],
    })
    expect(issues.filter(i => i.kind === 'unresolved-workspace-dep')).toEqual([])
    expect(issues.filter(i => i.kind === 'prerelease-version')).toEqual([])
  })

  it('ignores private and changeset-ignored packages for the stable-version check', async () => {
    const issues = await checkReleaseDryrun({
      packages: [
        pkg('@solvapay/server', '2.1.0'),
        pkg('@solvapay/test-utils', '0.0.0-canary.1', { private: true }),
        pkg('@example/checkout', '1.0.0-preview.1'),
      ],
      changesetIgnore: ['@example/*'],
      workflows: [workflow('publish.yml', DRY_RUN_WORKFLOW)],
    })
    expect(issues.filter(i => i.kind === 'prerelease-version')).toEqual([])
  })

  it('fails when a publish workflow has no dry-run default', async () => {
    const issues = await checkReleaseDryrun({
      packages: [pkg('@solvapay/server', '2.1.0')],
      changesetIgnore: [],
      workflows: [
        workflow(
          'publish.yml',
          `
on:
  push:
    branches: [main]
  workflow_dispatch:
`,
        ),
      ],
    })
    expect(
      issues.some(i => i.kind === 'missing-dry-run-default' && i.workflowFile === 'publish.yml'),
    ).toBe(true)
    expect(formatReleaseDryrunReport(issues)).toMatch(/publish\.yml/)
  })

  it('accepts dry_run default true or a publish_to_* flag defaulting to false', async () => {
    const issues = await checkReleaseDryrun({
      packages: [pkg('@solvapay/server', '2.1.0')],
      changesetIgnore: [],
      workflows: [
        workflow('publish.yml', DRY_RUN_WORKFLOW),
        workflow('publish-rust.yml', PUBLISH_FLAG_WORKFLOW),
      ],
    })
    expect(issues.filter(i => i.kind === 'missing-dry-run-default')).toEqual([])
  })
})

const probePresent: RegistryProbe = async () => ({ present: true })
const probeAbsent: RegistryProbe = async () => ({ present: false })

function probeByName(present: readonly string[]): RegistryProbe {
  const set = new Set(present)
  return async name => ({ present: set.has(name) })
}

describe('unpublished-workspace-dep', () => {
  it('fails when a workspace:* dep is absent from the registry', async () => {
    const issues = await checkReleaseDryrun({
      packages: [
        pkg('@solvapay/server', '2.1.0', {
          dependencies: { '@solvapay/server-wasm': 'workspace:*' },
        }),
        pkg('@solvapay/server-wasm', '0.1.0'),
      ],
      changesetIgnore: [],
      workflows: [workflow('publish.yml', DRY_RUN_WORKFLOW)],
      registryProbe: probeByName([]),
      unpublishedDepAllowlist: [],
    })
    expect(
      issues.some(
        i =>
          i.kind === 'unpublished-workspace-dep' &&
          i.packageName === '@solvapay/server' &&
          i.dependencyName === '@solvapay/server-wasm' &&
          !i.allowlistReason,
      ),
    ).toBe(true)
    expect(formatReleaseDryrunReport(issues)).toMatch(/@solvapay\/server-wasm/)
  })

  it('passes when the probe reports the dep present at any version', async () => {
    const issues = await checkReleaseDryrun({
      packages: [
        pkg('@solvapay/server', '2.1.0', {
          dependencies: { '@solvapay/server-wasm': 'workspace:*' },
        }),
        pkg('@solvapay/server-wasm', '0.1.0'),
      ],
      changesetIgnore: [],
      workflows: [workflow('publish.yml', DRY_RUN_WORKFLOW)],
      registryProbe: probePresent,
      unpublishedDepAllowlist: [],
    })
    expect(issues.filter(i => i.kind === 'unpublished-workspace-dep')).toEqual([])
  })

  it('passes for an allowlisted unpublished dep and the report includes the reason', async () => {
    const reason = 'nine unwired platform packages — rust-migration-map.md Step 39'
    const issues = await checkReleaseDryrun({
      packages: [
        pkg('@solvapay/server', '2.1.0', {
          optionalDependencies: { '@solvapay/server-native': 'workspace:*' },
        }),
        pkg('@solvapay/server-native', '0.1.0'),
      ],
      changesetIgnore: [],
      workflows: [workflow('publish.yml', DRY_RUN_WORKFLOW)],
      registryProbe: probeAbsent,
      unpublishedDepAllowlist: [{ name: '@solvapay/server-native', reason }],
    })
    const unpublished = issues.filter(i => i.kind === 'unpublished-workspace-dep')
    expect(unpublished.every(i => Boolean(i.allowlistReason))).toBe(true)
    expect(unpublished.some(i => i.dependencyName === '@solvapay/server-native')).toBe(true)
    expect(formatReleaseDryrunReport(issues)).toMatch(/nine unwired platform packages/)
  })

  it('fails when an allowlist entry has an empty or missing reason', async () => {
    const issues = await checkReleaseDryrun({
      packages: [
        pkg('@solvapay/server', '2.1.0', {
          optionalDependencies: { '@solvapay/server-native': 'workspace:*' },
        }),
        pkg('@solvapay/server-native', '0.1.0'),
      ],
      changesetIgnore: [],
      workflows: [workflow('publish.yml', DRY_RUN_WORKFLOW)],
      registryProbe: probeAbsent,
      unpublishedDepAllowlist: [{ name: '@solvapay/server-native', reason: '' }],
    })
    expect(
      issues.some(
        i =>
          i.kind === 'unpublished-workspace-dep' &&
          i.dependencyName === '@solvapay/server-native' &&
          !i.allowlistReason,
      ),
    ).toBe(true)
  })

  it('covers dependencies, peerDependencies, and optionalDependencies', async () => {
    const issues = await checkReleaseDryrun({
      packages: [
        pkg('@solvapay/server', '2.1.0', {
          dependencies: { '@solvapay/dep-a': 'workspace:*' },
          peerDependencies: { '@solvapay/dep-b': 'workspace:^' },
          optionalDependencies: { '@solvapay/dep-c': 'workspace:~' },
        }),
        pkg('@solvapay/dep-a', '1.0.0'),
        pkg('@solvapay/dep-b', '1.0.0'),
        pkg('@solvapay/dep-c', '1.0.0'),
      ],
      changesetIgnore: [],
      workflows: [workflow('publish.yml', DRY_RUN_WORKFLOW)],
      registryProbe: probeAbsent,
      unpublishedDepAllowlist: [],
    })
    const names = issues
      .filter(i => i.kind === 'unpublished-workspace-dep' && !i.allowlistReason)
      .map(i => i.dependencyName)
      .sort()
    expect(names).toEqual(['@solvapay/dep-a', '@solvapay/dep-b', '@solvapay/dep-c'])
  })

  it('skips the registry check when no probe is supplied', async () => {
    const issues = await checkReleaseDryrun({
      packages: [
        pkg('@solvapay/server', '2.1.0', {
          dependencies: { '@solvapay/server-wasm': 'workspace:*' },
        }),
        pkg('@solvapay/server-wasm', '0.1.0'),
      ],
      changesetIgnore: [],
      workflows: [workflow('publish.yml', DRY_RUN_WORKFLOW)],
    })
    expect(issues.filter(i => i.kind === 'unpublished-workspace-dep')).toEqual([])
  })

  it('requires a non-empty reason on every declared UNPUBLISHED_DEP_ALLOWLIST entry', () => {
    expect(UNPUBLISHED_DEP_ALLOWLIST.length).toBeGreaterThan(0)
    for (const entry of UNPUBLISHED_DEP_ALLOWLIST) {
      expect(entry.name).toMatch(/^@solvapay\//)
      expect(entry.reason.trim().length).toBeGreaterThan(0)
    }
    expect(UNPUBLISHED_DEP_ALLOWLIST.some(e => e.name === '@solvapay/server-native')).toBe(true)
  })
})

describe('release-dryrun live tree', () => {
  it('requires a dry-run default on all six publish workflows', async () => {
    const workflows: PublishWorkflowDoc[] = PUBLISH_WORKFLOW_FILES.map(fileName => ({
      fileName,
      yaml: readFileSync(path.join(WORKFLOWS_DIR, fileName), 'utf8'),
    }))
    const issues = (
      await checkReleaseDryrun({
        packages: [pkg('@solvapay/server', '2.1.0')],
        changesetIgnore: [],
        workflows,
      })
    ).filter(i => i.kind === 'missing-dry-run-default')
    expect(issues).toEqual([])
    expect(workflows).toHaveLength(6)
  })

  it('passes the live workspace (stable versions, workspace:* batch, dry-run defaults)', async () => {
    expect(await runReleaseDryrunCheck(REPO_ROOT)).toEqual([])
  })
})
