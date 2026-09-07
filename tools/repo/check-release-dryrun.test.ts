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
  npmRegistryVersionProbe,
  runReleaseDryrunCheck,
  type PublishWorkflowDoc,
  type RegistryProbe,
  type WorkspacePackage,
} from './lib/release-dryrun.js'
import { nativePlatformPackageNames, loadSupportMatrix } from './lib/support-matrix.js'
import {
  collectNativePlatformPublishTargets,
  verifyNativePlatformPublishes,
} from './lib/native-platform-publish.js'
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

  it('still accepts dry_run default true when force_native is also declared', async () => {
    const issues = await checkReleaseDryrun({
      packages: [pkg('@solvapay/server', '2.1.0')],
      changesetIgnore: [],
      workflows: [
        workflow(
          'publish.yml',
          `
on:
  workflow_dispatch:
    inputs:
      dry_run:
        type: boolean
        default: true
      force_native:
        type: boolean
        default: false
`,
        ),
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
  it('fails when a workspace:* dep is absent from the registry and the batch', async () => {
    const issues = await checkReleaseDryrun({
      packages: [
        pkg('@solvapay/server', '2.1.0', {
          dependencies: { '@solvapay/legacy-helper': 'workspace:*' },
        }),
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
          i.dependencyName === '@solvapay/legacy-helper' &&
          !i.allowlistReason,
      ),
    ).toBe(true)
    expect(formatReleaseDryrunReport(issues)).toMatch(/@solvapay\/legacy-helper/)
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
          optionalDependencies: { '@solvapay/not-in-batch': 'workspace:*' },
        }),
      ],
      changesetIgnore: [],
      workflows: [workflow('publish.yml', DRY_RUN_WORKFLOW)],
      registryProbe: probeAbsent,
      unpublishedDepAllowlist: [{ name: '@solvapay/not-in-batch', reason }],
    })
    const unpublished = issues.filter(i => i.kind === 'unpublished-workspace-dep')
    expect(unpublished.every(i => Boolean(i.allowlistReason))).toBe(true)
    expect(unpublished.some(i => i.dependencyName === '@solvapay/not-in-batch')).toBe(true)
    expect(formatReleaseDryrunReport(issues)).toMatch(/nine unwired platform packages/)
  })

  it('fails when an allowlist entry has an empty or missing reason', async () => {
    const issues = await checkReleaseDryrun({
      packages: [
        pkg('@solvapay/server', '2.1.0', {
          optionalDependencies: { '@solvapay/not-in-batch': 'workspace:*' },
        }),
      ],
      changesetIgnore: [],
      workflows: [workflow('publish.yml', DRY_RUN_WORKFLOW)],
      registryProbe: probeAbsent,
      unpublishedDepAllowlist: [{ name: '@solvapay/not-in-batch', reason: '' }],
    })
    expect(
      issues.some(
        i =>
          i.kind === 'unpublished-workspace-dep' &&
          i.dependencyName === '@solvapay/not-in-batch' &&
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
    for (const entry of UNPUBLISHED_DEP_ALLOWLIST) {
      expect(entry.name).toMatch(/^@solvapay\//)
      expect(entry.reason.trim().length).toBeGreaterThan(0)
    }
    expect(UNPUBLISHED_DEP_ALLOWLIST.some(e => e.name === '@solvapay/server-native')).toBe(false)
  })

  it('treats an unpublished workspace dep in the same publish batch as resolved', async () => {
    const issues = await checkReleaseDryrun({
      packages: [
        pkg('@solvapay/server', '2.1.0', {
          optionalDependencies: { '@solvapay/server-native': 'workspace:*' },
        }),
        pkg('@solvapay/server-native', '0.1.0', {
          optionalDependencies: { '@solvapay/server-native-darwin-arm64': 'workspace:*' },
        }),
        pkg('@solvapay/server-native-darwin-arm64', '0.1.0'),
      ],
      changesetIgnore: [],
      workflows: [workflow('publish.yml', DRY_RUN_WORKFLOW)],
      registryProbe: async () => ({ present: false }),
    })
    expect(issues.filter(i => i.kind === 'unpublished-workspace-dep')).toEqual([])
  })
})

describe('local-path-dep', () => {
  it('does not fail file: production deps unless assertNoLocalPaths is set', async () => {
    const issues = await checkReleaseDryrun({
      packages: [
        pkg('@solvapay/server-native', '0.1.0', {
          optionalDependencies: { '@solvapay/server-native-darwin-arm64': 'file:npm/darwin-arm64' },
        }),
      ],
      changesetIgnore: [],
      workflows: [workflow('publish.yml', DRY_RUN_WORKFLOW)],
    })
    expect(issues.filter(i => i.kind === 'local-path-dep')).toEqual([])
  })

  it('fails file:, link:, and portal: production deps when assertNoLocalPaths is set', async () => {
    const issues = await checkReleaseDryrun({
      packages: [
        pkg('@solvapay/server', '2.1.0', {
          dependencies: { '@solvapay/helper': 'file:../helper' },
          peerDependencies: { '@solvapay/plugin': 'link:../plugin' },
          optionalDependencies: {
            '@solvapay/server-native-darwin-arm64': 'portal:./npm/darwin-arm64',
          },
        }),
      ],
      changesetIgnore: [],
      workflows: [workflow('publish.yml', DRY_RUN_WORKFLOW)],
      assertNoLocalPaths: true,
    })
    const names = issues
      .filter(i => i.kind === 'local-path-dep')
      .map(i => i.dependencyName)
      .sort()
    expect(names).toEqual([
      '@solvapay/helper',
      '@solvapay/plugin',
      '@solvapay/server-native-darwin-arm64',
    ])
    expect(formatReleaseDryrunReport(issues)).toMatch(/file:|link:|portal:/)
  })

  it('ignores private and changeset-ignored packages for the local-path check', async () => {
    const issues = await checkReleaseDryrun({
      packages: [
        pkg('@solvapay/server', '2.1.0'),
        pkg('@solvapay/test-utils', '0.0.0', {
          private: true,
          dependencies: { helper: 'file:../helper' },
        }),
        pkg('@example/checkout', '1.0.0', {
          optionalDependencies: { native: 'file:./npm/darwin-arm64' },
        }),
      ],
      changesetIgnore: ['@example/*'],
      workflows: [workflow('publish.yml', DRY_RUN_WORKFLOW)],
      assertNoLocalPaths: true,
    })
    expect(issues.filter(i => i.kind === 'local-path-dep')).toEqual([])
  })

  it('passes when publishable optionalDependencies are semver pins', async () => {
    const issues = await checkReleaseDryrun({
      packages: [
        pkg('@solvapay/server-native', '0.1.0', {
          optionalDependencies: { '@solvapay/server-native-darwin-arm64': '0.1.0' },
        }),
      ],
      changesetIgnore: [],
      workflows: [workflow('publish.yml', DRY_RUN_WORKFLOW)],
      assertNoLocalPaths: true,
    })
    expect(issues.filter(i => i.kind === 'local-path-dep')).toEqual([])
  })

  it('flags the live loader file: pins when assertNoLocalPaths is set', async () => {
    const issues = await runReleaseDryrunCheck(REPO_ROOT, undefined, { assertNoLocalPaths: true })
    expect(
      issues.some(
        i =>
          i.kind === 'local-path-dep' &&
          i.packageName === '@solvapay/server-native' &&
          i.dependencyName === '@solvapay/server-native-darwin-arm64',
      ),
    ).toBe(true)
  })
})

describe('verify-native-platform-publishes', () => {
  it('collects all 8 platform packages at the loader version', () => {
    const targets = collectNativePlatformPublishTargets(REPO_ROOT)
    const matrix = loadSupportMatrix(REPO_ROOT)
    expect(targets).toHaveLength(8)
    expect(targets.map(t => t.name)).toEqual(nativePlatformPackageNames(matrix))
    expect(new Set(targets.map(t => t.version)).size).toBe(1)
    expect(targets[0]?.version).toMatch(/\d+\.\d+\.\d+/)
  })

  it('passes when every name@version is fetchable', async () => {
    const result = await verifyNativePlatformPublishes({
      packages: [
        { name: '@solvapay/server-native-darwin-arm64', version: '0.1.0' },
        { name: '@solvapay/server-native-linux-x64-gnu', version: '0.1.0' },
      ],
      probe: async () => ({ kind: 'found' }),
      sleep: async () => undefined,
    })
    expect(result.missing).toEqual([])
  })

  it('fails when a version-aware probe never finds a package', async () => {
    const result = await verifyNativePlatformPublishes({
      packages: [
        { name: '@solvapay/server-native-darwin-arm64', version: '0.1.0' },
        { name: '@solvapay/server-native-linux-x64-gnu', version: '0.1.0' },
      ],
      probe: async name =>
        name === '@solvapay/server-native-linux-x64-gnu' ? { kind: 'missing' } : { kind: 'found' },
      deadlineMs: 30,
      backoffMs: [1],
      sleep: async () => undefined,
      now: (() => {
        let t = 0
        return () => {
          t += 20
          return t
        }
      })(),
    })
    expect(result.missing).toEqual([
      { name: '@solvapay/server-native-linux-x64-gnu', version: '0.1.0' },
    ])
  })

  it('retries a transient probe then accepts the version', async () => {
    let calls = 0
    const result = await verifyNativePlatformPublishes({
      packages: [{ name: '@solvapay/server-native-darwin-arm64', version: '0.1.0' }],
      probe: async () => {
        calls += 1
        return calls === 1 ? { kind: 'transient-error', message: '503' } : { kind: 'found' }
      },
      deadlineMs: 1_000,
      backoffMs: [1],
      sleep: async () => undefined,
    })
    expect(result.missing).toEqual([])
    expect(calls).toBe(2)
  })

  it('probes GET /name/version and treats 404 as absent', async () => {
    const seen: string[] = []
    const probe = npmRegistryVersionProbe(async url => {
      seen.push(url)
      return new Response(null, { status: 404 })
    })
    expect(await probe('@solvapay/server-native-darwin-arm64', '0.1.0')).toEqual({
      present: false,
    })
    expect(seen).toEqual([
      'https://registry.npmjs.org/%40solvapay%2Fserver-native-darwin-arm64/0.1.0',
    ])
  })
})

describe('release-dryrun live tree', () => {
  it('exposes dry-run-only force_native on the npm publish workflows', () => {
    const publishYml = readFileSync(path.join(WORKFLOWS_DIR, 'publish.yml'), 'utf8')
    const previewYml = readFileSync(path.join(WORKFLOWS_DIR, 'publish-preview.yml'), 'utf8')
    expect(publishYml).toMatch(/force_native:\n(?: {2,}.*\n)* {8}default: false/)
    expect(previewYml).toMatch(/force_native:\n(?: {2,}.*\n)* {8}default: false/)
    expect(publishYml).toMatch(/native_leg:/)
    expect(publishYml).toContain("needs.detect.result == 'success'")
    expect(publishYml).toContain("needs.detect.outputs.native_leg == 'true'")
    expect(previewYml).toContain('!inputs.dry_run || inputs.force_native')
    expect(previewYml).toContain('publish-native-platform-packages.ts --dry-run')
  })

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
    expect(PUBLISH_WORKFLOW_FILES).not.toContain('native-build.yml')
  })

  it('passes the live workspace (stable versions, workspace:* batch, dry-run defaults)', async () => {
    expect(await runReleaseDryrunCheck(REPO_ROOT)).toEqual([])
  })

  it('exposes pnpm dryrun as npm rehearsal then language preview dry-run', () => {
    const raw: unknown = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'))
    if (typeof raw !== 'object' || raw === null || !('scripts' in raw)) {
      throw new Error('package.json missing scripts')
    }
    const scripts = raw.scripts
    if (typeof scripts !== 'object' || scripts === null || !('dryrun' in scripts)) {
      throw new Error('package.json missing scripts.dryrun')
    }
    expect(scripts.dryrun).toBe('pnpm release:dryrun && pnpm preview --dry-run --accept-partial')
  })
})
