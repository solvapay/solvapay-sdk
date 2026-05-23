/**
 * `create-paid-mcp-app` CLI entrypoint.
 *
 * Invoked as `npm create paid-mcp-app <project>` (npm strips the
 * `create-` prefix and spawns `npx create-paid-mcp-app <project>`).
 * `pnpm create paid-mcp-app` and `yarn create paid-mcp-app` follow the
 * same conventions; use the `--` separator to pass flags through
 * (e.g. `npm create paid-mcp-app my-mcp -- --yes`).
 */

import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import readline from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { HELP_TEXT, inferMode, parseArgs, sanitizeProjectName, validateToolName } from './args'
import { runFromOpenapi } from './from-openapi'
import { runFromScratch } from './from-scratch'

const require = createRequire(import.meta.url)
const pkg = require('../package.json') as { version: string }

const DEFAULT_TOOL_NAME = 'helloTool'

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))

  if (args.help) {
    process.stdout.write(HELP_TEXT)
    return
  }
  if (args.version) {
    process.stdout.write(`${pkg.version}\n`)
    return
  }
  if (args.unknownFlag) {
    process.stderr.write(`Unknown or invalid flag: ${args.unknownFlag}\n\n${HELP_TEXT}`)
    process.exitCode = 2
    return
  }

  const nonInteractive = args.nonInteractive || args.yes || !stdin.isTTY

  const projectName = await resolveProjectName(args.projectName, nonInteractive)
  const target = resolve(process.cwd(), projectName)

  let mode = inferMode(args)
  if (mode === null) {
    if (nonInteractive) {
      process.stderr.write(
        `--openapi or --no-openapi is required in non-interactive mode.\n\n${HELP_TEXT}`,
      )
      process.exitCode = 2
      return
    }
    const hasSpec = await askYesNo(
      'Do you have an OpenAPI / Swagger spec to wrap as paid MCP tools? [y/N] ',
      false,
    )
    mode = hasSpec ? 'from-openapi' : 'from-scratch'
  }

  const initOptions = { yes: args.yes }

  if (mode === 'from-openapi') {
    const spec = await resolveOpenapiSpec(args.openapi, nonInteractive)
    await runFromOpenapi({
      target,
      projectName,
      spec,
      options: initOptions,
      productRef: args.product,
      nonInteractive,
    })
    return
  }

  const toolName = await resolveToolName(args.toolName, nonInteractive)
  await runFromScratch({
    target,
    projectName,
    toolName,
    options: initOptions,
    productRef: args.product,
  })
}

async function resolveProjectName(value: string | undefined, nonInteractive: boolean): Promise<string> {
  let raw = value
  if (!raw) {
    if (nonInteractive) {
      throw new Error(
        'project-name positional argument is required in non-interactive mode. Run with --help for usage.',
      )
    }
    if (!stdin.isTTY || !stdout.isTTY) {
      throw new Error('project-name positional argument is required.')
    }
    raw = await ask('Project directory name (kebab-case): ')
  }
  const result = sanitizeProjectName(raw)
  if (!result.ok) {
    throw new Error(result.reason)
  }
  return result.name
}

async function resolveOpenapiSpec(value: string | undefined, nonInteractive: boolean): Promise<string> {
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

async function resolveToolName(value: string | undefined, nonInteractive: boolean): Promise<string> {
  if (value) {
    const validated = validateToolName(value)
    if (!validated.ok) throw new Error(validated.reason)
    return validated.name
  }
  if (nonInteractive || !stdin.isTTY) {
    return DEFAULT_TOOL_NAME
  }
  const answer = (await ask(`Placeholder tool name (camelCase, default ${DEFAULT_TOOL_NAME}): `)).trim()
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

main().catch(err => {
  const message = err instanceof Error ? err.message : 'unknown error'
  process.stderr.write(`Error: ${message}\n`)
  process.exitCode = 1
})
