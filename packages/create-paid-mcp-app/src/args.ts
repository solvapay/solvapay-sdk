/**
 * Argv parser for `create-paid-mcp-app`.
 *
 * Kept lightweight — no commander/yargs dependency — because the entire
 * surface is one positional + a handful of long flags. Pure functions,
 * exhaustively unit-tested.
 */

export type Mode = 'from-openapi' | 'from-scratch'

export type ParsedArgs = {
  projectName?: string
  openapi?: string
  noOpenapi: boolean
  toolName?: string
  product?: string
  yes: boolean
  nonInteractive: boolean
  help: boolean
  version: boolean
  unknownFlag?: string
}

const FLAG_ALIASES: Record<string, string> = {
  '-y': '--yes',
  '-h': '--help',
}

const VALUE_FLAGS = new Set(['--openapi', '--tool-name', '--product'])
const BOOLEAN_FLAGS = new Set([
  '--no-openapi',
  '--yes',
  '--non-interactive',
  '--help',
  '--version',
])

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const out: ParsedArgs = {
    noOpenapi: false,
    yes: false,
    nonInteractive: false,
    help: false,
    version: false,
  }

  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i]
    const arg = FLAG_ALIASES[raw] ?? raw

    if (arg === '--') {
      // Pass-through separator; ignore.
      continue
    }

    if (!arg.startsWith('-')) {
      if (out.projectName === undefined) {
        out.projectName = arg
      }
      continue
    }

    if (VALUE_FLAGS.has(arg)) {
      const value = argv[++i]
      if (value === undefined || value.startsWith('-')) {
        out.unknownFlag = `${arg} requires a value`
        return out
      }
      if (arg === '--openapi') out.openapi = value
      if (arg === '--tool-name') out.toolName = value
      if (arg === '--product') out.product = value
      continue
    }

    if (BOOLEAN_FLAGS.has(arg)) {
      if (arg === '--no-openapi') out.noOpenapi = true
      if (arg === '--yes') out.yes = true
      if (arg === '--non-interactive') {
        out.nonInteractive = true
        out.yes = true
      }
      if (arg === '--help') out.help = true
      if (arg === '--version') out.version = true
      continue
    }

    out.unknownFlag = arg
    return out
  }

  return out
}

/**
 * Determine which mode the user requested based on flags. Returns
 * `null` when the choice cannot be determined non-interactively and a
 * prompt is needed.
 */
export function inferMode(args: ParsedArgs): Mode | null {
  if (args.openapi) return 'from-openapi'
  if (args.noOpenapi) return 'from-scratch'
  return null
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
  npm create paid-mcp-app <project-name> -- [flags]
  pnpm create paid-mcp-app <project-name> [flags]
  yarn create paid-mcp-app <project-name> [flags]
  npx create-paid-mcp-app <project-name> [flags]

Modes:
  from-openapi    Scaffold a paid MCP server from an OpenAPI / Swagger spec.
  from-scratch    Scaffold with a single placeholder paid tool (no upstream API).

Flags:
  --openapi <url|path>   Spec URL or local path. Implies --mode from-openapi.
  --no-openapi           Skip OpenAPI; scaffold from-scratch.
  --tool-name <camel>    Placeholder tool name in from-scratch mode (default: helloTool).
  --product <ref>        Pre-fill SOLVAPAY_PRODUCT_REF (skip the picker).
  -y, --yes              Non-interactive: accept all defaults.
  --non-interactive      Alias for --yes; fail fast on any missing prompt input.
  -h, --help             Show this help.
  --version              Print package version.

For intent-driven tool clustering (one MCP tool spanning multiple upstream
operations), run this scaffolder through Cursor or Claude Code with the
create-paid-mcp-app skill loaded — intent-driven mode needs an LLM agent
to author the resulting src/tools/*.ts files.

Docs: https://docs.solvapay.com
`
