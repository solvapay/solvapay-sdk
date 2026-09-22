/**
 * Step 55-b — required-checks drift gate unit tests (RED→GREEN).
 *
 * Fixture cases prove the checker fails on (1) a ci.yml job absent from the
 * manifest, (2) a stale manifest name, (3) matrix expansion drift, and (4) a
 * notRequired/deferred entry without an allowed reason. The live tree is
 * checked separately via `pnpm checks:required`.
 */

import { describe, expect, it } from 'vitest'
import {
  checkRequiredChecks,
  expandMatrixCombinations,
  formatRequiredChecksReport,
  interpolateMatrixName,
  type RequiredChecksManifest,
  type WorkflowJob,
} from './lib/required-checks.js'

const required = (name: string, jobId: string): RequiredChecksManifest['checks'][number] => ({
  name,
  jobId,
  gate: 'TS API diff',
})

describe('required-checks fixtures', () => {
  it('fails when a ci.yml job is absent from the manifest (missing-required)', () => {
    const jobs: WorkflowJob[] = [
      { id: 'lint-build-test', name: 'Lint, Build & Test' },
      { id: 'rust', name: 'Rust' },
    ]
    const manifest: RequiredChecksManifest = {
      schemaVersion: 1,
      branch: 'main',
      checks: [required('Lint, Build & Test', 'lint-build-test')],
    }

    const issues = checkRequiredChecks(jobs, manifest)
    expect(issues.some(i => i.kind === 'missing-required' && i.name === 'Rust')).toBe(true)
    expect(formatRequiredChecksReport(issues)).toMatch(/Rust/)
  })

  it('fails when the manifest lists a check with no matching workflow job (stale-manifest)', () => {
    const jobs: WorkflowJob[] = [{ id: 'lint-build-test', name: 'Lint, Build & Test' }]
    const manifest: RequiredChecksManifest = {
      schemaVersion: 1,
      branch: 'main',
      checks: [
        required('Lint, Build & Test', 'lint-build-test'),
        required('does-not-exist-anymore', 'ghost-job'),
      ],
    }

    const issues = checkRequiredChecks(jobs, manifest)
    expect(
      issues.some(i => i.kind === 'stale-manifest' && i.name === 'does-not-exist-anymore'),
    ).toBe(true)
    expect(formatRequiredChecksReport(issues)).toMatch(/does-not-exist-anymore/)
  })

  it('fails when strategy.matrix expansion count/name mismatches the manifest (matrix-drift)', () => {
    const jobs: WorkflowJob[] = [
      {
        id: 'node-clean-install-native',
        name: 'node clean install (native, ${{ matrix.target.id }}, Node ${{ matrix.node }})',
        matrix: {
          node: ['22', '24', '26'],
          target: [{ id: 'linux-x64-gnu' }, { id: 'darwin-arm64' }],
        },
      },
    ]
    const expanded = [
      'node clean install (native, linux-x64-gnu, Node 22)',
      'node clean install (native, linux-x64-gnu, Node 24)',
      'node clean install (native, linux-x64-gnu, Node 26)',
      'node clean install (native, darwin-arm64, Node 22)',
      'node clean install (native, darwin-arm64, Node 24)',
      'node clean install (native, darwin-arm64, Node 26)',
    ]
    const manifest: RequiredChecksManifest = {
      schemaVersion: 1,
      branch: 'main',
      checks: expanded.slice(0, 5).map(name => required(name, 'node-clean-install-native')),
    }

    const issues = checkRequiredChecks(jobs, manifest)
    expect(
      issues.some(i => i.kind === 'matrix-drift' && i.jobId === 'node-clean-install-native'),
    ).toBe(true)
    expect(formatRequiredChecksReport(issues)).toMatch(/matrix-drift|darwin-arm64/)
  })

  it('fails when a notRequired/deferred entry has no allowed reason (invalid-reason)', () => {
    const jobs: WorkflowJob[] = [
      { id: 'lint-build-test', name: 'Lint, Build & Test' },
      { id: 'docs', name: 'Documentation Validation' },
    ]
    const missingReason: RequiredChecksManifest = {
      schemaVersion: 1,
      branch: 'main',
      checks: [
        required('Lint, Build & Test', 'lint-build-test'),
        {
          name: 'Documentation Validation',
          jobId: 'docs',
          gate: 'Documentation validation',
          required: false,
        },
      ],
    }
    expect(checkRequiredChecks(jobs, missingReason).some(i => i.kind === 'invalid-reason')).toBe(
      true,
    )

    const badReason: RequiredChecksManifest = {
      schemaVersion: 1,
      branch: 'main',
      checks: [
        required('Lint, Build & Test', 'lint-build-test'),
        {
          name: 'Documentation Validation',
          jobId: 'docs',
          gate: 'Documentation validation',
          required: false,
          reason: 'not-a-real-reason',
        },
      ],
    }
    expect(checkRequiredChecks(jobs, badReason).some(i => i.kind === 'invalid-reason')).toBe(true)

    const badDeferred: RequiredChecksManifest = {
      schemaVersion: 1,
      branch: 'main',
      checks: [
        {
          name: 'Lint, Build & Test',
          jobId: 'lint-build-test',
          gate: 'TS API diff',
          deferred: 'not-a-real-reason',
        },
        {
          name: 'Documentation Validation',
          jobId: 'docs',
          gate: 'Documentation validation',
          required: false,
          reason: 'dispatch-only',
        },
      ],
    }
    expect(checkRequiredChecks(jobs, badDeferred).some(i => i.kind === 'invalid-reason')).toBe(true)
  })

  it('passes a matching required set and interpolates nested matrix names', () => {
    const combinations = expandMatrixCombinations({
      node: ['22'],
      settings: [{ target: 'x86_64-unknown-linux-gnu' }, { target: 'aarch64-apple-darwin' }],
    })
    expect(combinations).toHaveLength(2)
    expect(
      interpolateMatrixName('node-binding (${{ matrix.settings.target }})', combinations[0]!),
    ).toBe('node-binding (x86_64-unknown-linux-gnu)')

    const jobs: WorkflowJob[] = [
      { id: 'lint-build-test', name: 'Lint, Build & Test' },
      {
        id: 'python-binding',
        name: 'python-binding (${{ matrix.platform }})',
        matrix: { include: [{ platform: 'manylinux-x86_64' }, { platform: 'win-amd64' }] },
      },
      {
        id: 'c-binding',
        name: 'c-binding (native C ABI)',
      },
    ]
    const manifest: RequiredChecksManifest = {
      schemaVersion: 1,
      branch: 'main',
      checks: [
        required('Lint, Build & Test', 'lint-build-test'),
        required('python-binding (manylinux-x86_64)', 'python-binding'),
        required('python-binding (win-amd64)', 'python-binding'),
        {
          name: 'c-binding (native C ABI)',
          jobId: 'c-binding',
          gate: 'Shared fixture conformance',
          deferred: 'c-abi-smoke-only',
        },
      ],
    }
    expect(checkRequiredChecks(jobs, manifest)).toEqual([])
    expect(formatRequiredChecksReport([])).toBe('required-checks: OK')
  })
})
