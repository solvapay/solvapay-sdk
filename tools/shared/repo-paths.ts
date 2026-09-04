/**
 * Load `contract/manifest/repo-paths.yaml` and derive dto-gen argv / drift paths.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import { REPO_ROOT } from './paths.js'
import { parseRepoPathsManifest, type RepoPathsManifest } from './repo-paths-schema.js'

/** Bootstrap path of the layout manifest (the one relative path loaders may hardcode). */
export const REPO_PATHS_MANIFEST_REL = 'contract/manifest/repo-paths.yaml'

function abs(rel: string, root = REPO_ROOT): string {
  return path.join(root, ...rel.split('/'))
}

export function loadRepoPathsManifest(root: string = REPO_ROOT): RepoPathsManifest {
  const filePath = path.join(root, ...REPO_PATHS_MANIFEST_REL.split('/'))
  const raw: unknown = parseYaml(readFileSync(filePath, 'utf8'))
  return parseRepoPathsManifest(raw)
}

function dtoGenConfigArgs(): string[] {
  return ['--config', REPO_PATHS_MANIFEST_REL]
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
  _manifest: RepoPathsManifest = loadRepoPathsManifest(),
  _root: string = REPO_ROOT,
): string[] {
  return dtoGenConfigArgs()
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

export function externalGeneratedEntries(
  manifest: RepoPathsManifest = loadRepoPathsManifest(),
): RepoPathsManifest['externalGenerated'] {
  return manifest.externalGenerated
}

export function externalGeneratedEntry(
  id: string,
  manifest: RepoPathsManifest = loadRepoPathsManifest(),
): RepoPathsManifest['externalGenerated'][number] {
  const entry = manifest.externalGenerated.find(item => item.id === id)
  if (entry === undefined) {
    const valid = manifest.externalGenerated.map(item => item.id).join(', ')
    throw new Error(`unknown externalGenerated artifact id: ${id} (valid: ${valid})`)
  }
  return entry
}

export function lookupPath(
  key: string,
  manifest: RepoPathsManifest = loadRepoPathsManifest(),
  root: string = REPO_ROOT,
): string {
  const rel = manifest.lookups[key]
  if (rel === undefined) {
    throw new Error(`unknown repo-paths lookup: ${key}`)
  }
  return abs(rel, root)
}

/** Lookup keys for language-SDK copies of the MCP App widget. */
export const MCP_APP_WIDGET_COPY_KEYS = [
  'mcpAppWidgetPython',
  'mcpAppWidgetRuby',
  'mcpAppWidgetGo',
  'mcpAppWidgetRust',
  'mcpAppWidgetTypescript',
] as const

export interface McpAppWidgetLayout {
  canonicalRel: string
  distRel: string
  copiesRel: string[]
}

function requireLookup(manifest: RepoPathsManifest, key: string): string {
  const rel = manifest.lookups[key]
  if (rel === undefined) {
    throw new Error(`unknown repo-paths lookup: ${key}`)
  }
  return rel
}

/** Canonical widget artifact + the vendored SDK copies from `lookups`. */
export function mcpAppWidgetLayout(
  manifest: RepoPathsManifest = loadRepoPathsManifest(),
): McpAppWidgetLayout {
  return {
    canonicalRel: requireLookup(manifest, 'mcpAppWidgetCanonical'),
    distRel: requireLookup(manifest, 'mcpAppWidgetDist'),
    copiesRel: MCP_APP_WIDGET_COPY_KEYS.map(key => requireLookup(manifest, key)),
  }
}

export function contractInputPath(
  key: keyof RepoPathsManifest['contractInputs'],
  manifest: RepoPathsManifest = loadRepoPathsManifest(),
): string {
  return abs(manifest.contractInputs[key].path)
}

export function sdkPath(
  key: string,
  manifest: RepoPathsManifest = loadRepoPathsManifest(),
  root: string = REPO_ROOT,
): string {
  const rel = manifest.sdks[key as keyof RepoPathsManifest['sdks']]
  if (rel === undefined) {
    throw new Error(`unknown sdk surface: ${key}`)
  }
  return abs(rel, root)
}

export function dirPath(
  key: string,
  manifest: RepoPathsManifest = loadRepoPathsManifest(),
  root: string = REPO_ROOT,
): string {
  const rel = manifest.dirs[key as keyof RepoPathsManifest['dirs']]
  if (rel === undefined) {
    throw new Error(`unknown repo dir: ${key}`)
  }
  return abs(rel, root)
}
