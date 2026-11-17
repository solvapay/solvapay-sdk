import { resolve } from 'node:path'
import readline from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import type { ProjectType } from '../registry'
import type { RunOptions } from '../../args'
import { parseLanguage, type Language } from '@solvapay/init'
import {
  inferMcpMode,
  MCP_HELP_TEXT,
  parseMcpArgs,
  toInitOptions,
  validateSnakeToolName,
  validateToolName,
} from '../../args'
import { isAbsoluteHttpUrl, runFromOpenapi } from './from-openapi'
import { runFromScratch } from './from-scratch'
import { DEFAULT_SNAKE_TOOL_NAME, runLanguageFromScratch } from './from-scratch-language'

const DEFAULT_TOOL_NAME = 'hello_tool'

export const mcpProjectType: ProjectType = {
  id: 'mcp',
  label: 'MCP server (TypeScript on Cloudflare Workers, or Python / Go)',
  summary:
    'Monetized MCP server: TypeScript on Cloudflare Workers, or Python / Go in a container (--language)',
  parseArgs: parseMcpArgs,
  run,
}

async function run(opts: RunOptions): Promise<void> {
  const { target, projectName, common, raw } = opts
  const mcpArgs = parseMcpArgs(raw)
  const nonInteractive = common.nonInteractive || common.yes || !stdin.isTTY

  if (mcpArgs.unknownFlag) {
    throw new Error(`Unknown or invalid MCP flag: ${mcpArgs.unknownFlag}\n\n${MCP_HELP_TEXT}`)
  }

  const language: Language = common.language ? parseLanguage(common.language) : 'ts'
  if (language !== 'ts') {
    if (mcpArgs.openapi) {
      throw new Error(
        `--openapi is TypeScript only. Python and Go servers are scaffolded from scratch: drop --openapi, or use --language ts.`,
      )
    }
    if (common.offline) {
      throw new Error(
        '--offline pins the npm packages this release ships with; Python and Go have no such pins. Drop --offline.',
      )
    }
    const toolName = await resolveSnakeToolName(mcpArgs.toolName, nonInteractive)
    await runLanguageFromScratch({
      target,
      projectName,
      toolName,
      language,
      options: toInitOptions(common),
      productRef: common.product,
      skipInstall: common.skipInstall,
      skipInit: common.skipInit,
      preview: common.preview,
      dev: common.dev,
    })
    return
  }

  let mode = inferMcpMode(mcpArgs)
  if (mode === null) {
    if (nonInteractive) {
      throw new Error(
        `--openapi or --no-openapi is required in non-interactive mode.\n\n${MCP_HELP_TEXT}`,
      )
    }
    const hasSpec = await askYesNo(
      'Do you have an OpenAPI / Swagger spec to wrap as paid MCP tools? [y/N] ',
      false,
    )
    mode = hasSpec ? 'from-openapi' : 'from-scratch'
  }

  const initOptions = toInitOptions(common)

  if (mode === 'from-openapi') {
    const spec = await resolveOpenapiSpec(mcpArgs.openapi, nonInteractive)
    await runFromOpenapi({
      target,
      projectName,
      spec,
      options: initOptions,
      productRef: common.product,
      nonInteractive,
      skipInstall: common.skipInstall,
      skipInit: common.skipInit,
      offline: common.offline,
      preview: common.preview,
      dev: common.dev,
    })
    return
  }

  const toolName = await resolveToolName(mcpArgs.toolName, nonInteractive)
  await runFromScratch({
    target,
    projectName,
    toolName,
    options: initOptions,
    productRef: common.product,
    skipInstall: common.skipInstall,
    skipInit: common.skipInit,
    offline: common.offline,
    preview: common.preview,
    dev: common.dev,
  })
}

async function resolveSnakeToolName(
  value: string | undefined,
  nonInteractive: boolean,
): Promise<string> {
  const answer =
    value ??
    (nonInteractive || !stdin.isTTY
      ? DEFAULT_SNAKE_TOOL_NAME
      : (
          await ask(`Placeholder tool name (snake_case, default ${DEFAULT_SNAKE_TOOL_NAME}): `)
        ).trim() || DEFAULT_SNAKE_TOOL_NAME)
  const validated = validateSnakeToolName(answer)
  if (!validated.ok) throw new Error(validated.reason)
  return validated.name
}

async function resolveOpenapiSpec(
  value: string | undefined,
  nonInteractive: boolean,
): Promise<string> {
  if (value && value.trim()) return resolveSpecLocation(value.trim())
  if (nonInteractive) {
    throw new Error('--openapi <url|path> is required in non-interactive from-openapi mode.')
  }
  if (!stdin.isTTY) {
    throw new Error('--openapi <url|path> is required when stdin is not a TTY.')
  }
  const answer = await ask('OpenAPI spec URL or local path: ')
  const trimmed = answer.trim()
  if (!trimmed) {
    throw new Error('No spec provided.')
  }
  return resolveSpecLocation(trimmed)
}

/**
 * Keep http(s) spec URLs as-is. Resolve local paths against the user's
 * cwd — `describe.mjs` / `scaffold.mjs` spawn with `cwd` set to
 * `scripts/mcp/`, so a relative `./openapi.yaml` would otherwise look
 * inside the published package.
 */
export function resolveSpecLocation(value: string): string {
  if (isAbsoluteHttpUrl(value)) return value
  return resolve(process.cwd(), value)
}

async function resolveToolName(value: string | undefined, nonInteractive: boolean): Promise<string> {
  if (value) {
    const validated = validateToolName(value)
    if (!validated.ok) throw new Error(validated.reason)
    return validated.name
  }
  if (nonInteractive || !stdin.isTTY) {
    return DEFAULT_TOOL_NAME
  }
  const answer = (await ask(`Placeholder tool name (snake_case, default ${DEFAULT_TOOL_NAME}): `)).trim()
  if (!answer) return DEFAULT_TOOL_NAME
  const validated = validateToolName(answer)
  if (!validated.ok) throw new Error(validated.reason)
  return validated.name
}

async function ask(prompt: string): Promise<string> {
  const rl = readline.createInterface({ input: stdin, output: stdout })
  try {
    return await rl.question(prompt)
  } finally {
    rl.close()
  }
}

async function askYesNo(prompt: string, defaultYes: boolean): Promise<boolean> {
  const rl = readline.createInterface({ input: stdin, output: stdout })
  try {
    const answer = (await rl.question(prompt)).trim().toLowerCase()
    if (!answer) return defaultYes
    return answer === 'y' || answer === 'yes'
  } finally {
    rl.close()
  }
}
