/**
 * Warn when rebuilt external blobs differ from the committed sha256 registry.
 */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  checkBinaryHashes,
  isBinaryArtifact,
  parseHashRegistry,
  type VerifyResult,
} from '../../codegen/external-generated.js'
import { REPO_ROOT } from '../../shared/paths.js'
import { loadRepoPathsManifest } from '../../shared/repo-paths.js'
import type { RepoPathsManifest } from '../../shared/repo-paths-schema.js'

export const EXTERNAL_BLOB_DRIFT_BANNER =
  'WARNING: rebuilt blobs differ from committed hashes — do NOT commit unless intended (use `pnpm generated:external --rebuild`)'

export interface BlobWarningDeps {
  manifest?: RepoPathsManifest
  root?: string
  digest?: (rel: string) => string
  registryText?: string
  stagedPaths?: string[]
}

function defaultDigest(root: string): (rel: string) => string {
  return rel =>
    createHash('sha256')
      .update(readFileSync(path.join(root, ...rel.split('/'))))
      .digest('hex')
}

export function binaryArtifactPaths(
  manifest: Pick<RepoPathsManifest, 'externalGenerated'> = loadRepoPathsManifest(),
): string[] {
  const out: string[] = []
  for (const entry of manifest.externalGenerated) {
    for (const rel of entry.paths) {
      if (isBinaryArtifact(entry, rel)) {
        out.push(rel)
      }
    }
  }
  return out
}

export function collectBinaryHashResults(deps: BlobWarningDeps = {}): VerifyResult[] {
  const manifest = deps.manifest ?? loadRepoPathsManifest()
  const root = deps.root ?? REPO_ROOT
  const digest = deps.digest ?? defaultDigest(root)
  const registryText =
    deps.registryText ??
    readFileSync(path.join(root, ...manifest.sha256Registry.split('/')), 'utf8')
  return checkBinaryHashes(
    manifest.externalGenerated,
    new Map(parseHashRegistry(registryText).map(row => [row.path, row.hash])),
    digest,
  )
}

export function formatExternalBlobWarning(results: VerifyResult[]): string | undefined {
  if (results.length === 0) {
    return undefined
  }
  return [EXTERNAL_BLOB_DRIFT_BANNER, ...results.map(result => `  ${result.message}`)].join('\n')
}

export function stagedExternalBlobWarning(
  staged: string[],
  results: VerifyResult[],
  blobPaths: string[],
): string | undefined {
  const stagedSet = new Set(staged)
  const relevant = new Set(blobPaths.filter(rel => stagedSet.has(rel)))
  if (relevant.size === 0) {
    return undefined
  }
  const drifted = results.filter(result =>
    blobPaths.some(rel => relevant.has(rel) && result.message.includes(rel)),
  )
  return formatExternalBlobWarning(drifted)
}

export function nativeOnlyBlobWarning(
  argv: string[],
  deps: BlobWarningDeps = {},
): string | undefined {
  if (!argv.includes('--native-only')) {
    return undefined
  }
  return formatExternalBlobWarning(collectBinaryHashResults(deps))
}

export function stagedGitPaths(root: string = REPO_ROOT): string[] {
  const ran = spawnSync('git', ['diff', '--cached', '--name-only'], {
    cwd: root,
    encoding: 'utf8',
  })
  if (ran.status !== 0) {
    return []
  }
  return ran.stdout.split('\n').filter(line => line.length > 0)
}

export function warnStagedExternalBlobs(deps: BlobWarningDeps = {}): string | undefined {
  const manifest = deps.manifest ?? loadRepoPathsManifest()
  const staged = deps.stagedPaths ?? stagedGitPaths(deps.root)
  return stagedExternalBlobWarning(
    staged,
    collectBinaryHashResults({ ...deps, manifest }),
    binaryArtifactPaths(manifest),
  )
}
