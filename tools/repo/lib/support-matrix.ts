import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'
import { joinRel, lookupRel } from '../../shared/paths.js'

const FilenameRule = z.object({
  id: z.string().min(1),
  os: z.string().min(1).optional(),
  target: z.string().min(1).optional(),
  manylinux: z.string().optional(),
  filenameIncludes: z.array(z.string()).default([]),
  filenameExcludes: z.array(z.string()).default([]),
  filenameAnyOf: z.array(z.string()).default([]),
})

const NativeTarget = z.object({
  dir: z.string().min(1),
  packageName: z.string().min(1),
  rustTriple: z.string().min(1),
  kind: z.literal('node'),
  binary: z.string().min(1),
  platform: z.string().min(1),
  arch: z.string().min(1),
  libc: z.string().nullable(),
  ciHost: z.string().min(1),
  ciContainer: z.string().nullable(),
})

export const SupportMatrixSchema = z.object({
  version: z.literal(1),
  notSupported: z.object({
    architectures: z.array(z.string().min(1)).min(1),
    reason: z.string().min(1),
  }),
  python: z.object({
    cpython: z.array(z.string().min(1)).min(1),
    abi: z.string().min(1),
    freeThreaded: z.literal('not-supported'),
    manylinux: z.string().min(1),
    manylinuxWheelTags: z.array(z.string().min(1)).min(1),
    wheels: z.array(FilenameRule).min(1),
  }),
  ruby: z.object({
    abis: z.array(z.string().min(1)).min(1),
    requiredRuby: z.string().min(1),
    windows: z.literal('source-gem-only'),
    windowsReason: z.string().min(1),
    gems: z.array(FilenameRule).min(1),
  }),
  nodeNative: z.object({
    nodeMajors: z.array(z.string().min(1)).min(1),
    targets: z.array(NativeTarget).min(1),
  }),
})

export type SupportMatrix = z.infer<typeof SupportMatrixSchema>

export const SUPPORT_MATRIX_YAML_REL = lookupRel('supportMatrix')
export const SUPPORT_MATRIX_JSON_REL = lookupRel('supportMatrixJson')

export function parseSupportMatrix(raw: unknown): SupportMatrix {
  return SupportMatrixSchema.parse(raw)
}

export function loadSupportMatrix(repoRoot: string): SupportMatrix {
  const yamlPath = joinRel(repoRoot, SUPPORT_MATRIX_YAML_REL)
  return parseSupportMatrix(parseYaml(readFileSync(yamlPath, 'utf8')))
}

export function supportMatrixJson(matrix: SupportMatrix): string {
  return `${JSON.stringify(matrix, null, 2)}\n`
}

export function writeSupportMatrixJson(
  repoRoot: string,
  matrix: SupportMatrix = loadSupportMatrix(repoRoot),
): string {
  const dest = joinRel(repoRoot, SUPPORT_MATRIX_JSON_REL)
  writeFileSync(dest, supportMatrixJson(matrix))
  return dest
}

export function supportMatrixJsonIsCurrent(repoRoot: string): boolean {
  const expected = supportMatrixJson(loadSupportMatrix(repoRoot))
  const actual = readFileSync(joinRel(repoRoot, SUPPORT_MATRIX_JSON_REL), 'utf8')
  return actual === expected
}

export function filenameMatchesRule(
  filename: string,
  rule: SupportMatrix['python']['wheels'][number],
): boolean {
  const n = filename.toLowerCase()
  if (rule.filenameIncludes.some(part => !n.includes(part.toLowerCase()))) return false
  if (rule.filenameExcludes.some(part => n.includes(part.toLowerCase()))) return false
  if (
    rule.filenameAnyOf.length > 0 &&
    !rule.filenameAnyOf.some(part => n.includes(part.toLowerCase()))
  ) {
    return false
  }
  return true
}

export function nativePlatformPackageNames(matrix: SupportMatrix): string[] {
  return matrix.nodeNative.targets.map(t => t.packageName)
}

export function resolveSupportMatrixPath(repoRoot: string, rel = SUPPORT_MATRIX_JSON_REL): string {
  return path.join(repoRoot, ...rel.split('/'))
}
