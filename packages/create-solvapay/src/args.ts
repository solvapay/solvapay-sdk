/**
 * Argv parser for `create-solvapay`.
 *
 * Two-level parsing: top-level common flags (including `--type`), then
 * per-type sub-parsers (e.g. `parseMcpArgs`). Kept lightweight — no
 * commander/yargs dependency.
 */

import type { InitCommandOptions } from '@solvapay/init'

export type ParsedCommonArgs = {
  projectName?: string
  type?: string
  auth?: string
  product?: string
  /** `--language ts|python|go` (raw; validated by the project type). */
  language?: string
  yes: boolean
  dev: boolean
  /** `--preview`: pin the newest SDK previews instead of the newest stable releases. */
  preview: boolean
  nonInteractive: boolean
  help: boolean
  version: boolean
  listTypes: boolean
  skipInstall: boolean
  skipInit: boolean
  offline: boolean
  unknownFlag?: string
}

export type McpMode = 'from-openapi' | 'from-scratch'

export type ParsedMcpArgs = {
  openapi?: string
  noOpenapi: boolean
  toolName?: string
  help: boolean
  unknownFlag?: string
}

export type ParsedTypeArgs = ParsedMcpArgs

export type RunOptions = {
  target: string
  projectName: string
  common: ParsedCommonArgs
  raw: readonly string[]
}

const FLAG_ALIASES: Record<string, string> = {
  '-y': '--yes',
  '-h': '--help',
}

const COMMON_SKIP_FLAGS = new Set([
  '--type',
  '--auth',
  '--yes',
  '--non-interactive',
  '--product',
  '--skip-install',
  '--skip-init',
  '--offline',
  '--dev',
  '--language',
  '--preview',
])

const COMMON_VALUE_FLAGS = new Set(['--type', '--auth', '--product', '--language'])
const COMMON_BOOLEAN_FLAGS = new Set([
  '--yes',
  '--non-interactive',
  '--help',
  '--version',
  '--list-types',
  '--skip-install',
  '--skip-init',
  '--offline',
  '--dev',
  '--preview',
])

const MCP_VALUE_FLAGS = new Set(['--openapi', '--tool-name'])
const MCP_BOOLEAN_FLAGS = new Set(['--no-openapi', '--help'])

export const MCP_SPECIFIC_FLAGS = new Set(['--openapi', '--no-openapi', '--tool-name'])

export function parseArgs(argv: readonly string[]): ParsedCommonArgs {
  const out: ParsedCommonArgs = {
    yes: false,
    dev: false,
    preview: false,
    nonInteractive: false,
    help: false,
    version: false,
    listTypes: false,
    skipInstall: false,
    skipInit: false,
    offline: false,
  }

  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i]
    const arg = FLAG_ALIASES[raw] ?? raw

    if (arg === '--') {
      continue
    }

    if (!arg.startsWith('-')) {
      if (out.projectName === undefined) {
        out.projectName = arg
      }
      continue
    }

    if (COMMON_VALUE_FLAGS.has(arg)) {
      const value = argv[++i]
      if (value === undefined || value.startsWith('-')) {
        out.unknownFlag = `${arg} requires a value`
        return out
      }
      if (arg === '--type') out.type = value
      if (arg === '--auth') out.auth = value
      if (arg === '--product') out.product = value
      if (arg === '--language') out.language = value
      continue
    }

    if (COMMON_BOOLEAN_FLAGS.has(arg)) {
      if (arg === '--yes') out.yes = true
      if (arg === '--non-interactive') {
        out.nonInteractive = true
        out.yes = true
      }
      if (arg === '--help') out.help = true
      if (arg === '--version') out.version = true
      if (arg === '--list-types') out.listTypes = true
      if (arg === '--skip-install') out.skipInstall = true
      if (arg === '--skip-init') out.skipInit = true
      if (arg === '--offline') out.offline = true
      if (arg === '--dev') out.dev = true
      if (arg === '--preview') out.preview = true
      continue
    }

    if (MCP_SPECIFIC_FLAGS.has(arg)) {
      if (arg === '--openapi' || arg === '--tool-name') {
        i++
      }
      continue
    }

    out.unknownFlag = arg
    return out
  }

  return out
}

export function parseMcpArgs(argv: readonly string[]): ParsedMcpArgs {
  const out: ParsedMcpArgs = {
    noOpenapi: false,
    help: false,
  }

  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i]
    const arg = FLAG_ALIASES[raw] ?? raw

    if (arg === '--') {
      continue
    }

    if (!arg.startsWith('-')) {
      continue
    }

    if (COMMON_SKIP_FLAGS.has(arg)) {
      if (arg === '--type' || arg === '--auth' || arg === '--product' || arg === '--language') {
        i++
      }
      continue
    }

    if (MCP_VALUE_FLAGS.has(arg)) {
      const value = argv[++i]
      if (value === undefined || value.startsWith('-')) {
        out.unknownFlag = `${arg} requires a value`
        return out
      }
      if (arg === '--openapi') out.openapi = value
      if (arg === '--tool-name') out.toolName = value
      continue
    }

    if (MCP_BOOLEAN_FLAGS.has(arg)) {
      if (arg === '--no-openapi') out.noOpenapi = true
      if (arg === '--help') out.help = true
      continue
    }

    out.unknownFlag = arg
    return out
  }

  return out
}

export function hasMcpSpecificFlags(argv: readonly string[]): boolean {
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i]
    const arg = FLAG_ALIASES[raw] ?? raw
    if (MCP_SPECIFIC_FLAGS.has(arg)) return true
  }
  return false
}

export function inferMcpMode(args: ParsedMcpArgs): McpMode | null {
  if (args.openapi) return 'from-openapi'
  if (args.noOpenapi) return 'from-scratch'
  return null
}

export function toInitOptions(common: ParsedCommonArgs): InitCommandOptions {
  return {
    yes: common.yes,
    dev: common.dev,
    productRef: common.product,
    ...(common.preview ? { preview: true } : {}),
  }
}

const KEBAB_RE = /^[a-z][a-z0-9-]*$/

export function sanitizeProjectName(name: string): { ok: true; name: string } | { ok: false; reason: string } {
  const trimmed = name.trim()
  if (!trimmed) return { ok: false, reason: 'project name is empty' }
  const lower = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-_.]+|[-_.]+$/g, '')
  if (!lower) return { ok: false, reason: 'project name has no usable characters' }
  if (!KEBAB_RE.test(lower)) {
    return {
      ok: false,
      reason: `"${name}" is not a valid project name (use lowercase letters, numbers, and hyphens)`,
    }
  }
  return { ok: true, name: lower }
}

const CAMEL_RE = /^[a-z][a-zA-Z0-9]*$/
const SNAKE_RE = /^[a-z][a-z0-9_]*$/

/** A Python or Go tool name: snake_case, so it is also a valid Python function name. */
export function validateSnakeToolName(
  name: string,
): { ok: true; name: string } | { ok: false; reason: string } {
  const trimmed = name.trim()
  if (!trimmed) return { ok: false, reason: 'tool name is empty' }
  if (!SNAKE_RE.test(trimmed)) {
    return {
      ok: false,
      reason: `"${name}" must be snake_case for Python and Go (lowercase letters, digits and underscores, starting with a letter)`,
    }
  }
  return { ok: true, name: trimmed }
}

export function validateToolName(name: string): { ok: true; name: string } | { ok: false; reason: string } {
  const trimmed = name.trim()
  if (!trimmed) return { ok: false, reason: 'tool name is empty' }
  if (!CAMEL_RE.test(trimmed)) {
    return {
      ok: false,
      reason: `"${name}" must be camelCase (start lowercase, letters and digits only — no hyphens, spaces, or punctuation)`,
    }
  }
  return { ok: true, name: trimmed }
}

export const HELP_TEXT = `Usage:
  npm create solvapay <project-name> -- --type <kind> [flags]

Project types:
  mcp    Monetized MCP server: TypeScript on Cloudflare Workers (from-openapi or
         from-scratch), or Python / Go in a container (from-scratch)
  next-auth0  Next.js + Auth0 starter with SolvaPay middleware wiring

Common flags:
  --type <kind>          Project type to scaffold (default: prompt; required if non-interactive)
  --auth <provider>      Shortcut surface for auth-focused starters (e.g. auth0).
  -y, --yes              Non-interactive: accept all defaults
  --product <ref>        Pre-fill SOLVAPAY_PRODUCT_REF (skip the picker)
  --non-interactive      Alias for --yes; fail fast on any missing prompt input
  --list-types           List available project types and exit
  --skip-install         Skip the post-scaffold dependency install (run \`npm install\` manually)
  --skip-init            Skip the post-scaffold \`solvapay init\` step (no browser OAuth)
  --offline              Pin @solvapay/* to the versions this release ships with instead of
                         npm's latest (without it, a failed registry lookup stops the scaffold).
                         TypeScript only.
  --preview              Pin the newest SDK previews (npm \`preview\` tag, newest PyPI /
                         Go proxy pre-release) instead of the newest stable releases
  --dev                  Target the SolvaPay dev backend (api-dev.solvapay.com).
                         Internal testing only — production keys are rejected
                         by api-dev. Seeds .env and forwards through to
                         \`solvapay init --dev\`.
  -h, --help             Show this help (bare) or per-type help (with --type)
  --version              Print package version

npm create solvapay <name> -- --type mcp --help    # MCP-specific help
Docs: https://docs.solvapay.com
`

export const MCP_HELP_TEXT = `Usage:
  npm create solvapay <project-name> -- --type mcp [flags]

MCP sub-modes:
  from-openapi    Scaffold a paid MCP server from an OpenAPI / Swagger spec.
  from-scratch    Scaffold with a single placeholder paid tool (no upstream API).

MCP flags:
  --language <lang>      ts (default), python or go. Python and Go servers are
                         from-scratch only and run in a container (Dockerfile
                         included); TypeScript runs on Cloudflare Workers.
  --openapi <url|path>   Spec URL or local path. Implies from-openapi sub-mode.
                         TypeScript only.
  --no-openapi           Skip OpenAPI; scaffold from-scratch.
  --tool-name <name>     Placeholder paid tool name in from-scratch mode: camelCase
                         for TypeScript (default helloTool), snake_case for Python
                         and Go (default hello_tool).
  --preview              Pin the newest SDK preview instead of the newest stable release.
  --dev                  Target the SolvaPay dev backend (api-dev.solvapay.com).
                         Internal testing only. Seeds .env with
                         SOLVAPAY_API_BASE_URL=https://api-dev.solvapay.com
                         and forwards through to \`solvapay init --dev\`.
  -h, --help             Show this help.

For intent-driven tool clustering (one MCP tool spanning multiple upstream
operations), run this scaffolder through Cursor or Claude Code with the
solvapay/create-mcp-app skill loaded — intent-driven mode needs an LLM agent
to author the resulting src/tools/*.ts files.

Docs: https://docs.solvapay.com
`
