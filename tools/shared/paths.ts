/**
 * Repo-root discovery and layout constants.
 *
 * Root is the directory holding `pnpm-workspace.yaml`, found by walking up
 * from a start path — never by hop-counting from `import.meta.url`.
 * Directory names come from `contract/manifest/repo-paths.yaml`.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'
import {
  INTERNAL_PACKAGE_IDS,
  parseRepoPathsManifest,
  SDK_SURFACE_IDS,
  TOOL_PACKAGE_IDS,
  TS_PACKAGE_IDS,
  type InternalPackageId,
  type RepoPathsManifest,
  type SdkSurfaceId,
  type ToolPackageId,
  type TsPackageId,
} from './repo-paths-schema.js'

const WORKSPACE_MARKER = 'pnpm-workspace.yaml'

/**
 * Walk `startDir` and its ancestors until `pnpm-workspace.yaml` is found.
 *
 * @throws if no marker exists between `startDir` and the filesystem root
 */
export function findRepoRoot(startDir: string): string {
  let dir = path.resolve(startDir)
  while (true) {
    if (existsSync(path.join(dir, WORKSPACE_MARKER))) {
      return dir
    }
    const parent = path.dirname(dir)
    if (parent === dir) {
      throw new Error(
        `Could not find repo root (${WORKSPACE_MARKER}) walking up from ${startDir}`,
      )
    }
    dir = parent
  }
}

/** Absolute path to the solvapay-sdk monorepo root. */
export const REPO_ROOT = findRepoRoot(path.dirname(fileURLToPath(import.meta.url)))

/** Join a repo-root-relative posix path onto `REPO_ROOT`. */
export function joinRoot(rel: string): string {
  return path.join(REPO_ROOT, ...rel.split('/'))
}

function loadLayout(): RepoPathsManifest {
  const filePath = joinRoot('contract/manifest/repo-paths.yaml')
  return parseRepoPathsManifest(parseYaml(readFileSync(filePath, 'utf8')))
}

const LAYOUT = loadLayout()

/** Parsed layout manifest (same document `repo-paths.ts` derives dto-gen from). */
export const REPO_PATHS: RepoPathsManifest = LAYOUT

/** Absolute path to `contract/`. */
export const CONTRACT_DIR = joinRoot(LAYOUT.dirs.contract)
/** Absolute path to `core/`. */
export const CORE_DIR = joinRoot(LAYOUT.dirs.core)
/** Absolute path to `sdks/typescript/`. */
export const SDKS_TYPESCRIPT_DIR = joinRoot(LAYOUT.dirs.sdksTypescript)
/** Absolute path to `internal/`. */
export const INTERNAL_DIR = joinRoot(LAYOUT.dirs.internal)
/** Absolute path to `docs/`. */
export const DOCS_DIR = joinRoot(LAYOUT.dirs.docs)
/** Absolute path to `examples/`. */
export const EXAMPLES_DIR = joinRoot(LAYOUT.dirs.examples)
/** Absolute path to `tools/`. */
export const TOOLS_DIR = joinRoot(LAYOUT.dirs.tools)
/** Absolute path to `tools/shared/`. */
export const SHARED_DIR = joinRoot(LAYOUT.dirs.toolsShared)
/** Absolute path to `tools/codegen/`. */
export const CODEGEN_DIR = joinRoot(LAYOUT.dirs.toolsCodegen)
/** Absolute path to `tools/conformance/`. */
export const CONFORMANCE_DIR = joinRoot(LAYOUT.dirs.toolsConformance)
/** Absolute path to `tools/repo/`. */
export const REPO_TOOLS_DIR = joinRoot(LAYOUT.dirs.toolsRepo)
/** Absolute path to `.github/workflows/`. */
export const WORKFLOWS_DIR = joinRoot(LAYOUT.dirs.workflows)
/** Absolute path to `.changeset/`. */
export const CHANGESET_DIR = joinRoot(LAYOUT.dirs.changeset)

export const SDK_SURFACES = SDK_SURFACE_IDS
export type SdkSurface = SdkSurfaceId
export { INTERNAL_PACKAGE_IDS, TOOL_PACKAGE_IDS, TS_PACKAGE_IDS }
export type { InternalPackageId, ToolPackageId, TsPackageId }

/** Join a repo-root-relative posix path onto an arbitrary root. */
export function joinRel(root: string, rel: string, ...extra: string[]): string {
  return path.join(root, ...rel.split('/'), ...extra)
}

/** Repo-root-relative path for a `lookups` key. */
export function lookupRel(key: string): string {
  const rel = LAYOUT.lookups[key]
  if (rel === undefined) {
    throw new Error(`unknown repo-paths lookup: ${key}`)
  }
  return rel
}

/** Absolute directory for a language / binding surface. */
export function sdkDir(surface: SdkSurface): string {
  return joinRoot(LAYOUT.sdks[surface])
}

/** Repo-root-relative directory for a published TypeScript SDK package. */
export function tsPackageRel(id: TsPackageId): string {
  return LAYOUT.tsPackages[id]
}

/** Absolute directory for a published TypeScript SDK package. */
export function tsPackageDir(id: TsPackageId): string {
  return joinRoot(tsPackageRel(id))
}

/** Repo-root-relative directory for a user-facing tool package. */
export function toolPackageRel(id: ToolPackageId): string {
  return LAYOUT.toolPackages[id]
}

/** Absolute directory for a user-facing tool package. */
export function toolPackageDir(id: ToolPackageId): string {
  return joinRoot(toolPackageRel(id))
}

/** Repo-root-relative directory for an internal TypeScript package. */
export function internalPackageRel(id: InternalPackageId): string {
  return LAYOUT.internalPackages[id]
}

/** Absolute directory for an internal TypeScript package. */
export function internalPackageDir(id: InternalPackageId): string {
  return joinRoot(internalPackageRel(id))
}
