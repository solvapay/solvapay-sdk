/**
 * `create-solvapay` CLI entrypoint.
 *
 * Invoked as `npm create solvapay <project>` (npm strips the
 * `create-` prefix and spawns `npx create-solvapay <project>`).
 * `pnpm create solvapay` and `yarn create solvapay` follow the
 * same conventions; use the `--` separator to pass flags through
 * (e.g. `npm create solvapay my-app -- --type mcp --yes`).
 */

import { resolve } from 'node:path'
import readline from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { languageChoiceEntries, promptChoice } from '@solvapay/init'
import {
  hasMcpSpecificFlags,
  HELP_TEXT,
  MCP_HELP_TEXT,
  parseArgs,
  parseMcpArgs,
  sanitizeProjectName,
} from './args'
import { assertLanguageSupported, formatLanguageList } from './languages/matrix'
import { PROJECT_TYPE_IDS, PROJECT_TYPES } from './types/registry'
import { PACKAGE_VERSION, printVersionBanner } from './version-banner'

async function main(): Promise<void> {
  const rawArgv = process.argv.slice(2)
  const args = parseArgs(rawArgv)

  if (args.version) {
    process.stdout.write(`${PACKAGE_VERSION}\n`)
    return
  }

  if (args.listTypes) {
    for (const id of PROJECT_TYPE_IDS) {
      const factory = PROJECT_TYPES[id]
      if (!factory) continue
      const type = await factory()
      process.stdout.write(`${type.id.padEnd(12)} ${type.summary}\n`)
      process.stdout.write(`             languages: ${formatLanguageList(type.supportedLanguages)}\n`)
    }
    return
  }

  const mcpFlagsWithoutType = hasMcpSpecificFlags(rawArgv) && args.type !== 'mcp'
  if (mcpFlagsWithoutType) {
    process.stderr.write(
      'MCP-specific flags (--openapi, --no-openapi, --tool-name) require --type mcp.\n\n' +
        HELP_TEXT,
    )
    process.exitCode = 2
    return
  }

  if (args.type === 'mcp') {
    const mcpArgs = parseMcpArgs(rawArgv)
    if (mcpArgs.help) {
      process.stdout.write(MCP_HELP_TEXT)
      return
    }
  }

  if (args.help) {
    process.stdout.write(HELP_TEXT)
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

  let typeId = args.type
  if (args.auth) {
    if (args.auth === 'auth0') {
      if (typeId && typeId !== 'next-auth0') {
        process.stderr.write('--auth auth0 is only compatible with --type next-auth0.\n')
        process.exitCode = 2
        return
      }
      typeId = 'next-auth0'
    } else {
      process.stderr.write(`Unknown --auth value: ${args.auth}. Valid: auth0\n`)
      process.exitCode = 2
      return
    }
  }
  if (!typeId) {
    if (nonInteractive) {
      process.stderr.write('--type <kind> is required in non-interactive mode.\n\n' + HELP_TEXT)
      process.exitCode = 2
      return
    }
    typeId = await promptProjectType()
  }

  const factory = PROJECT_TYPES[typeId]
  if (!factory) {
    process.stderr.write(`Unknown --type: ${typeId}. Valid: ${PROJECT_TYPE_IDS.join(', ')}\n`)
    process.exitCode = 2
    return
  }

  const type = await factory()
  let language = args.language
  if (!language) {
    if (type.supportedLanguages.length === 1) {
      language = type.supportedLanguages[0]
    } else if (nonInteractive) {
      language = 'ts'
    } else {
      language = await promptChoice(
        'Which language?',
        languageChoiceEntries(type.supportedLanguages),
      )
    }
  }
  if (!language) {
    process.stderr.write('Could not resolve a language.\n')
    process.exitCode = 2
    return
  }
  try {
    assertLanguageSupported(type.id, language)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unsupported language'
    process.stderr.write(`${message}\n`)
    process.exitCode = 2
    return
  }

  printVersionBanner()
  await type.run({ target, projectName, common: args, raw: rawArgv, language })
}

async function resolveProjectName(
  value: string | undefined,
  nonInteractive: boolean,
): Promise<string> {
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

async function promptProjectType(): Promise<string> {
  const entries: Array<{ id: string; label: string }> = []
  for (const id of PROJECT_TYPE_IDS) {
    const factory = PROJECT_TYPES[id]
    if (!factory) continue
    const type = await factory()
    entries.push({ id: type.id, label: type.label })
  }
  return promptChoice('What are you building?', entries)
}

async function ask(prompt: string): Promise<string> {
  const rl = readline.createInterface({ input: stdin, output: stdout })
  try {
    return await rl.question(prompt)
  } finally {
    rl.close()
  }
}

main().catch(err => {
  const message = err instanceof Error ? err.message : 'unknown error'
  process.stderr.write(`Error: ${message}\n`)
  process.exitCode = 1
})
