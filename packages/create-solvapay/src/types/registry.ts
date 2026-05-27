import type { ParsedTypeArgs, RunOptions } from '../args'

export type ProjectType = {
  id: string
  label: string
  summary: string
  parseArgs(argv: readonly string[]): ParsedTypeArgs
  run(opts: RunOptions): Promise<void>
}

export const PROJECT_TYPES: Record<string, () => Promise<ProjectType>> = {
  mcp: () => import('./mcp/index.js').then(m => m.mcpProjectType),
  // cli: () => import('./cli/index.js').then(m => m.cliProjectType), // future
}

export const PROJECT_TYPE_IDS = Object.keys(PROJECT_TYPES) as readonly string[]
