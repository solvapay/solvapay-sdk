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
  checkReleaseDryrun,
  formatReleaseDryrunReport,
  runReleaseDryrunCheck,
  type PublishWorkflowDoc,
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
  it('fails when a publishable package has a pre-release version', () => {
    const issues = checkReleaseDryrun({
      packages: [
        pkg('@solvapay/server', '2.1.0'),
        pkg('@solvapay/core', '1.0.8-preview.10'),
      ],
      changesetIgnore: ['@example/*'],
      workflows: [workflow('publish.yml', DRY_RUN_WORKFLOW)],
    })
    expect(
      issues.some(i => i.kind === 'prerelease-version' && i.packageName === '@solvapay/core'),
    ).toBe(true)
    expect(formatReleaseDryrunReport(issues)).toMatch(/1\.0\.8-preview\.10/)
  })

  it('fails when a workspace:* dep does not resolve within the publish batch', () => {
    const issues = checkReleaseDryrun({
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

  it('passes when workspace:* and workspace:^ deps resolve to a publishable sibling', () => {
    const issues = checkReleaseDryrun({
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

  it('ignores private and changeset-ignored packages for the stable-version check', () => {
    const issues = checkReleaseDryrun({
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

  it('fails when a publish workflow has no dry-run default', () => {
    const issues = checkReleaseDryrun({
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

  it('accepts dry_run default true or a publish_to_* flag defaulting to false', () => {
    const issues = checkReleaseDryrun({
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

describe('release-dryrun live tree', () => {
  it('requires a dry-run default on all six publish workflows', () => {
    const workflows: PublishWorkflowDoc[] = PUBLISH_WORKFLOW_FILES.map(fileName => ({
      fileName,
      yaml: readFileSync(path.join(WORKFLOWS_DIR, fileName), 'utf8'),
    }))
    const issues = checkReleaseDryrun({
      packages: [pkg('@solvapay/server', '2.1.0')],
      changesetIgnore: [],
      workflows,
    }).filter(i => i.kind === 'missing-dry-run-default')
    expect(issues).toEqual([])
    expect(workflows).toHaveLength(6)
  })

  it('passes the live workspace (stable versions, workspace:* batch, dry-run defaults)', () => {
    expect(runReleaseDryrunCheck(REPO_ROOT)).toEqual([])
  })
})
