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

export const RepoPathsManifestSchema = z
  .object({
    version: z.literal(1),
    dirs: z.object({
      contract: RelPath,
      core: RelPath,
      packages: RelPath,
      docs: RelPath,
      examples: RelPath,
      tools: RelPath,
      toolsShared: RelPath,
      toolsCodegen: RelPath,
      toolsConformance: RelPath,
      toolsRepo: RelPath,
      workflows: RelPath,
      changeset: RelPath,
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
    }),
    contractInputs: z.object({
      openapiSnapshot: FlaggedPath,
      sdkManifest: FlaggedPath,
      clientFixtures: FlaggedPath,
      fixtures: FlaggedPath,
    }),
    generated: z.array(GeneratedEntry).min(1),
    /** Ordered generated ids whose expanded paths are the `git diff` drift set. */
    drift: z.array(z.string().min(1)).min(1),
    lookups: z.record(z.string(), RelPath).default({}),
  })
  .superRefine((value, ctx) => {
    const ids = new Set<string>()
    for (const [index, entry] of value.generated.entries()) {
      if (ids.has(entry.id)) {
        ctx.addIssue({
          code: 'custom',
          message: `duplicate generated id: ${entry.id}`,
          path: ['generated', index, 'id'],
        })
      }
      ids.add(entry.id)
    }
    if (value.drift.length !== ids.size) {
      ctx.addIssue({
        code: 'custom',
        message: 'drift must list each generated id exactly once',
        path: ['drift'],
      })
    }
    for (const [index, id] of value.drift.entries()) {
      if (!ids.has(id)) {
        ctx.addIssue({
          code: 'custom',
          message: `drift id is not a generated id: ${id}`,
          path: ['drift', index],
        })
      }
    }
  })

export type RepoPathsManifest = z.infer<typeof RepoPathsManifestSchema>
export type GeneratedEntry = z.infer<typeof GeneratedEntry>
export type SdkSurfaceId = (typeof SDK_SURFACE_IDS)[number]

export function parseRepoPathsManifest(raw: unknown): RepoPathsManifest {
  return RepoPathsManifestSchema.parse(raw)
}
