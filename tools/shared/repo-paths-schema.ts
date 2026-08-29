/**
 * Zod schema for `contract/manifest/repo-paths.yaml`.
 *
 * The YAML is the single source of truth for cross-directory layout.
 * This module is parse-only — no filesystem I/O.
 */

import { z } from 'zod'

const RelPath = z
  .string()
  .min(1)
  .refine(value => !value.startsWith('/') && !value.includes('\\'), {
    message: 'paths must be repo-root-relative posix paths',
  })

const FlaggedPath = z.object({
  path: RelPath,
  flag: z.string().min(1).optional(),
})

const GeneratedEntry = z.object({
  id: z.string().min(1),
  path: RelPath,
  flag: z.string().min(1).optional(),
  /** Drift-check this path instead of `path` (e.g. crate dir vs `--out` src/). */
  driftPath: RelPath.optional(),
  /** Drift-check these files instead of `path` (binding dirs expand to files). */
  driftPaths: z.array(RelPath).min(1).optional(),
})

const ForbidPattern = z.object({
  path: RelPath,
  pattern: z.string().min(1),
  reason: z.string().min(1),
})

const ExternalGeneratedEntry = z.object({
  id: z.string().min(1),
  paths: z.array(RelPath).min(1),
  /** Shell command that reproduces `paths`. Printed verbatim on drift. */
  generator: z.string().min(1),
  /** Directory the generator runs in, repo-root-relative. */
  cwd: RelPath.optional(),
  /** Marker substring required in every text path; null when unmarkable. */
  marker: z.string().min(1).nullable().default('@generated'),
  /** gitDiff: generator writes in place. command: generator self-checks. */
  verify: z.enum(['gitDiff', 'command']).default('gitDiff'),
  /** Self-check command, required when verify === 'command'. */
  verifyCommand: z.string().min(1).optional(),
  /** Binary: skip marker, use the sha256 registry. */
  binary: z.boolean().default(false),
  /** Output is not bit-stable across hosts — drift warns instead of failing. */
  nonDeterministic: z.boolean().default(false),
  /** Substrings that must NOT appear (e.g. fixture-host symbol leakage). */
  forbidPatterns: z.array(ForbidPattern).default([]),
})

export const SDK_SURFACE_IDS = [
  'node-native',
  'wasm',
  'python',
  'ruby',
  'go',
  'capi',
  'rust',
  'typescript',
] as const

export const TS_PACKAGE_IDS = [
  'auth',
  'core',
  'mcp',
  'mcp-core',
  'next',
  'react',
  'react-supabase',
  'server',
] as const

export const TOOL_PACKAGE_IDS = ['cli', 'create-solvapay', 'init'] as const

export const INTERNAL_PACKAGE_IDS = ['demo-services', 'test-utils', 'tsconfig'] as const

export const RepoPathsManifestSchema = z
  .object({
    version: z.literal(1),
    dirs: z.object({
      contract: RelPath,
      core: RelPath,
      docs: RelPath,
      examples: RelPath,
      tools: RelPath,
      toolsShared: RelPath,
      toolsCodegen: RelPath,
      toolsConformance: RelPath,
      toolsRepo: RelPath,
      workflows: RelPath,
      changeset: RelPath,
      sdksTypescript: RelPath,
      internal: RelPath,
    }),
    sdks: z.object({
      'node-native': RelPath,
      wasm: RelPath,
      python: RelPath,
      ruby: RelPath,
      go: RelPath,
      capi: RelPath,
      rust: RelPath,
      typescript: RelPath,
      pythonMcp: RelPath,
      rubyMcp: RelPath,
      rustMcp: RelPath,
    }),
    tsPackages: z.object({
      auth: RelPath,
      core: RelPath,
      mcp: RelPath,
      'mcp-core': RelPath,
      next: RelPath,
      react: RelPath,
      'react-supabase': RelPath,
      server: RelPath,
    }),
    toolPackages: z.object({
      cli: RelPath,
      'create-solvapay': RelPath,
      init: RelPath,
    }),
    internalPackages: z.object({
      'demo-services': RelPath,
      'test-utils': RelPath,
      tsconfig: RelPath,
    }),
    contractInputs: z.object({
      openapiSnapshot: FlaggedPath,
      sdkManifest: FlaggedPath,
      coreSrc: FlaggedPath,
      bindingResidue: FlaggedPath,
      transportSrc: FlaggedPath,
      clientFixtures: FlaggedPath,
      fixtures: FlaggedPath,
    }),
    generated: z.array(GeneratedEntry).min(1),
    /** Ordered generated ids whose expanded paths are the `git diff` drift set. */
    drift: z.array(z.string().min(1)).min(1),
    /** Artifacts owned by external toolchains, not dto-gen. */
    externalGenerated: z.array(ExternalGeneratedEntry).min(1),
    /** SHA256 registry for binary artifacts listed in `externalGenerated`. */
    sha256Registry: RelPath,
    /** Marker-carrying files that are not generated artifacts. */
    markerExemptions: z
      .array(
        z.object({
          pattern: z.string().min(1),
          reason: z.string().min(1),
        }),
      )
      .default([]),
    lookups: z.record(z.string(), RelPath).default({}),
  })
  .superRefine((value, ctx) => {
    const generatedIds = collectUniqueIds(
      ctx,
      value.generated.map(entry => entry.id),
      'generated',
      'generated',
    )
    collectUniqueIds(
      ctx,
      value.externalGenerated.map(entry => entry.id),
      'externalGenerated',
      'externalGenerated',
    )
    if (value.drift.length !== generatedIds.size) {
      ctx.addIssue({
        code: 'custom',
        message: 'drift must list each generated id exactly once',
        path: ['drift'],
      })
    }
    for (const [index, id] of value.drift.entries()) {
      if (!generatedIds.has(id)) {
        ctx.addIssue({
          code: 'custom',
          message: `drift id is not a generated id: ${id}`,
          path: ['drift', index],
        })
      }
    }
    for (const [index, entry] of value.externalGenerated.entries()) {
      if (generatedIds.has(entry.id)) {
        ctx.addIssue({
          code: 'custom',
          message: `externalGenerated id collides with generated: ${entry.id}`,
          path: ['externalGenerated', index, 'id'],
        })
      }
      if (entry.verify === 'command' && entry.verifyCommand === undefined) {
        ctx.addIssue({
          code: 'custom',
          message: 'verifyCommand is required when verify is command',
          path: ['externalGenerated', index, 'verifyCommand'],
        })
      }
      if (entry.binary && entry.marker !== null) {
        ctx.addIssue({
          code: 'custom',
          message: 'binary entries must set marker: null',
          path: ['externalGenerated', index, 'marker'],
        })
      }
    }
  })

function collectUniqueIds(
  ctx: z.RefinementCtx,
  ids: string[],
  pathKey: string,
  label: string,
): Set<string> {
  const seen = new Set<string>()
  for (const [index, id] of ids.entries()) {
    if (seen.has(id)) {
      ctx.addIssue({
        code: 'custom',
        message: `duplicate ${label} id: ${id}`,
        path: [pathKey, index, 'id'],
      })
    }
    seen.add(id)
  }
  return seen
}

export type RepoPathsManifest = z.infer<typeof RepoPathsManifestSchema>
export type GeneratedEntry = z.infer<typeof GeneratedEntry>
export type ExternalGeneratedEntry = z.infer<typeof ExternalGeneratedEntry>
export type SdkSurfaceId = (typeof SDK_SURFACE_IDS)[number]
export type TsPackageId = (typeof TS_PACKAGE_IDS)[number]
export type ToolPackageId = (typeof TOOL_PACKAGE_IDS)[number]
export type InternalPackageId = (typeof INTERNAL_PACKAGE_IDS)[number]

export function parseRepoPathsManifest(raw: unknown): RepoPathsManifest {
  return RepoPathsManifestSchema.parse(raw)
}
