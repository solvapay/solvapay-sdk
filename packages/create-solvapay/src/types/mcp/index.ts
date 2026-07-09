import readline from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import type { ProjectType } from '../registry'
import {
  inferMcpMode,
  MCP_HELP_TEXT,
  parseMcpArgs,
  toInitOptions,
  validateToolName,
} from '../../args'
import { runFromOpenapi } from './from-openapi'
import { runFromScratch } from './from-scratch'

const DEFAULT_TOOL_NAME = 'helloTool'

export const mcpProjectType: ProjectType = {
  id: 'mcp',
  label: 'MCP server (Cloudflare Workers)',
  summary: 'Monetized MCP server on Cloudflare Workers (from-openapi or from-scratch)',
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
    dev: common.dev,
  })
}

async function resolveOpenapiSpec(
  value: string | undefined,
  nonInteractive: boolean,
): Promise<string> {
  if (value && value.trim()) return value.trim()
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
  return trimmed
}

async function resolveToolName(
  value: string | undefined,
  nonInteractive: boolean,
): Promise<string> {
  if (value) {
    const validated = validateToolName(value)
    if (!validated.ok) throw new Error(validated.reason)
    return validated.name
  }
  if (nonInteractive || !stdin.isTTY) {
    return DEFAULT_TOOL_NAME
  }
  const answer = (
    await ask(`Placeholder tool name (camelCase, default ${DEFAULT_TOOL_NAME}): `)
  ).trim()
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
