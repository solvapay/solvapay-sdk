/**
 * Shared helpers for publishing and verifying the 8 native platform packages.
 */

import { readFileSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'
import { joinRel, lookupRel } from '../../shared/paths.js'
import { npmPackageVersionUrl } from './release-dryrun.js'
import { loadSupportMatrix } from './support-matrix.js'

export const NATIVE_PUBLISH_DEADLINE_MS = 10 * 60_000
export const NATIVE_PUBLISH_BACKOFF_MS = [10_000, 20_000, 30_000, 60_000] as const

export type NativePlatformPublishTarget = {
  name: string
  version: string
  dir: string
}

export type VersionProbeKind = 'found' | 'missing' | 'transient-error'

export type VersionProbeResult =
  | { kind: 'found' }
  | { kind: 'missing' }
  | { kind: 'transient-error'; message: string }

export type NativeVersionProbe = (
  packageName: string,
  version: string,
) => Promise<VersionProbeResult>

export function readNativeLoaderVersion(repoRoot: string): string {
  const loaderAbs = joinRel(repoRoot, lookupRel('nodeNativePackage'))
  const raw: unknown = JSON.parse(readFileSync(loaderAbs, 'utf8'))
  if (
    typeof raw !== 'object' ||
    raw === null ||
    !('version' in raw) ||
    typeof raw.version !== 'string' ||
    raw.version.length === 0
  ) {
    throw new Error('native-platform-publish: loader version missing')
  }
  return raw.version
}

export function collectNativePlatformPublishTargets(
  repoRoot: string,
  version = readNativeLoaderVersion(repoRoot),
): NativePlatformPublishTarget[] {
  const matrix = loadSupportMatrix(repoRoot)
  return matrix.nodeNative.targets.map(target => ({
    name: target.packageName,
    version,
    dir: target.dir,
  }))
}

export async function probeNpmPackageVersion(
  packageName: string,
  version: string,
  options: { registry?: string; fetchImpl?: typeof fetch } = {},
): Promise<VersionProbeResult> {
  const url = npmPackageVersionUrl(packageName, version, options.registry)
  try {
    const response = await (options.fetchImpl ?? fetch)(url, { method: 'GET' })
    if (response.status === 404) return { kind: 'missing' }
    if (!response.ok) {
      return { kind: 'transient-error', message: `unexpected ${response.status}` }
    }
    return { kind: 'found' }
  } catch (err) {
    return {
      kind: 'transient-error',
      message: err instanceof Error ? err.message : String(err),
    }
  }
}

export async function npmPackageVersionExists(
  packageName: string,
  version: string,
  options: { registry?: string; fetchImpl?: typeof fetch } = {},
): Promise<boolean> {
  const result = await probeNpmPackageVersion(packageName, version, options)
  if (result.kind === 'transient-error') {
    throw new Error(
      `npm registry version probe for ${packageName}@${version} failed: ${result.message}`,
    )
  }
  return result.kind === 'found'
}

function backoffForRound(roundIndex: number, backoffMs: readonly number[]): number {
  if (roundIndex < backoffMs.length) return backoffMs[roundIndex] ?? backoffMs[backoffMs.length - 1]
  return backoffMs[backoffMs.length - 1] ?? 60_000
}

export async function verifyNativePlatformPublishes(input: {
  packages: ReadonlyArray<{ name: string; version: string }>
  probe: NativeVersionProbe
  deadlineMs?: number
  backoffMs?: readonly number[]
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}): Promise<{ missing: Array<{ name: string; version: string }> }> {
  const deadlineMs = input.deadlineMs ?? NATIVE_PUBLISH_DEADLINE_MS
  const backoffMs = input.backoffMs ?? NATIVE_PUBLISH_BACKOFF_MS
  const wait = input.sleep ?? sleep
  const now = input.now ?? Date.now
  const startedAt = now()
  const pending = input.packages.map(pkg => ({ pkg }))
  let round = 0

  while (pending.length > 0) {
    const elapsed = now() - startedAt
    if (elapsed >= deadlineMs) break

    round += 1
    const stillPending: Array<{ pkg: { name: string; version: string } }> = []

    for (const entry of pending) {
      const result = await input.probe(entry.pkg.name, entry.pkg.version)
      if (result.kind === 'found') continue
      if (result.kind === 'transient-error' && round === 1) {
        console.warn(`  ${entry.pkg.name}@${entry.pkg.version}: ${result.message}, retrying...`)
      }
      stillPending.push(entry)
    }

    if (stillPending.length === 0) {
      pending.length = 0
      break
    }

    const elapsedAfterRound = now() - startedAt
    if (elapsedAfterRound >= deadlineMs) {
      pending.splice(0, pending.length, ...stillPending)
      break
    }

    for (const entry of stillPending) {
      console.warn(
        `  waiting on ${entry.pkg.name}@${entry.pkg.version} (not on registry yet; ${elapsedAfterRound}ms elapsed)`,
      )
    }

    pending.splice(0, pending.length, ...stillPending)
    const remaining = deadlineMs - (now() - startedAt)
    if (remaining <= 0) break
    await wait(Math.min(backoffForRound(round - 1, backoffMs), remaining))
  }

  return { missing: pending.map(entry => entry.pkg) }
}
