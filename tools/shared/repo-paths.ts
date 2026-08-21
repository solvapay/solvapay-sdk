/**
 * Load `contract/manifest/repo-paths.yaml` and derive dto-gen argv / drift paths.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import { REPO_ROOT } from './paths.js'
import {
  parseRepoPathsManifest,
  type RepoPathsManifest,
} from './repo-paths-schema.js'

/** Bootstrap path of the layout manifest (the one relative path loaders may hardcode). */
export const REPO_PATHS_MANIFEST_REL = 'contract/manifest/repo-paths.yaml'

function posixRelative(from: string, to: string): string {
  return path.relative(from, to).split(path.sep).join('/')
}

function abs(rel: string, root = REPO_ROOT): string {
  return path.join(root, ...rel.split('/'))
}

export function loadRepoPathsManifest(root: string = REPO_ROOT): RepoPathsManifest {
  const filePath = path.join(root, ...REPO_PATHS_MANIFEST_REL.split('/'))
  const raw: unknown = parseYaml(readFileSync(filePath, 'utf8'))
  return parseRepoPathsManifest(raw)
}

function dtoGenFlagPairs(manifest: RepoPathsManifest, root: string): string[] {
  const pairs: string[] = []
  const inputs = [
    manifest.contractInputs.openapiSnapshot,
    manifest.contractInputs.sdkManifest,
    manifest.contractInputs.coreSrc,
    manifest.contractInputs.bindingResidue,
    manifest.contractInputs.transportSrc,
  ]
  for (const item of inputs) {
    if (item.flag === undefined) {
      throw new Error(`contract input ${item.path} is missing a dto-gen flag`)
    }
    pairs.push(item.flag, posixRelative(root, abs(item.path, root)))
  }
  for (const item of manifest.generated) {
    if (item.flag === undefined) {
      continue
    }
    pairs.push(item.flag, posixRelative(root, abs(item.path, root)))
  }
  return pairs
}

function driftPathsFor(manifest: RepoPathsManifest): string[] {
  const byId = new Map(manifest.generated.map(item => [item.id, item]))
  const out: string[] = []
  for (const id of manifest.drift) {
    const item = byId.get(id)
    if (item === undefined) {
      throw new Error(`drift id missing from generated: ${id}`)
    }
    if (item.driftPaths !== undefined) {
      out.push(...item.driftPaths)
      continue
    }
    if (item.driftPath !== undefined) {
      out.push(item.driftPath)
      continue
    }
    out.push(item.path)
  }
  return out
}

export function dtoGenArgs(
  manifest: RepoPathsManifest = loadRepoPathsManifest(),
  root: string = REPO_ROOT,
): string[] {
  return dtoGenFlagPairs(manifest, root)
}

export function generatedDriftPaths(
  manifest: RepoPathsManifest = loadRepoPathsManifest(),
): string[] {
  return driftPathsFor(manifest)
}

export function generatedEntry(
  id: string,
  manifest: RepoPathsManifest = loadRepoPathsManifest(),
): RepoPathsManifest['generated'][number] {
  const entry = manifest.generated.find(item => item.id === id)
  if (entry === undefined) {
    throw new Error(`unknown generated artifact id: ${id}`)
  }
  return entry
}

export function lookupPath(
  key: string,
  manifest: RepoPathsManifest = loadRepoPathsManifest(),
): string {
  const rel = manifest.lookups[key]
  if (rel === undefined) {
    throw new Error(`unknown repo-paths lookup: ${key}`)
  }
  return abs(rel)
}

export function contractInputPath(
  key: keyof RepoPathsManifest['contractInputs'],
  manifest: RepoPathsManifest = loadRepoPathsManifest(),
): string {
  return abs(manifest.contractInputs[key].path)
}
