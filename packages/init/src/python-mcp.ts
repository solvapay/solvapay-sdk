/**
 * Can a Python project take SolvaPay's MCP server?
 *
 * `solvapay[mcp]` needs `mcp` 2.3 or later. `mcp` 2.0 removed
 * `mcp.server.fastmcp` (FastMCP became MCPServer), and `fastapi-mcp` runs only
 * on `mcp` 1.x. Installing `solvapay[mcp]` into such a project upgrades `mcp`
 * and leaves a server that cannot start, so `solvapay init` stops before
 * sign-in and `solvapay doctor` fails on the imports.
 *
 * Read from the project folder, not its parents: uv.lock, poetry.lock,
 * pyproject.toml, requirements.txt and every `.py` file outside virtualenvs,
 * hidden folders and build output.
 */
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { lockedPackage, readText } from './sdk-versions'

export const MCP_MIGRATION_GUIDE = 'https://py.sdk.modelcontextprotocol.io/v2/migration/'
export const PYTHON_MCP_GUIDE = 'https://docs.solvapay.com/sdks/python/guides/mcp'

/** The oldest `mcp` that `solvapay[mcp]` accepts. */
const REQUIRED_MCP = [2, 3, 0]

export type LegacyModule = 'mcp.server.fastmcp' | 'fastapi_mcp'
export type PythonImport = {
  /** Relative to the project folder, with forward slashes. */
  file: string
  line: number
  module: LegacyModule | 'fastmcp'
}

export type PythonMcpProject = {
  /** The `mcp` version from a lockfile or an exact requirements.txt pin. */
  mcp?: { version: string; source: string }
  /** Declared `mcp` requirements that rule out every version from 2.3 on. */
  mcpCaps: Array<{ requirement: string; source: string }>
  /** Files that declare or lock `fastapi-mcp`. */
  fastapiMcp: string[]
  /** Files that declare or lock `fastmcp`. */
  fastmcp: string[]
  /** Whether `solvapay[mcp]` is already declared. */
  solvapayMcpExtra: boolean
  imports: PythonImport[]
}

const LOCKFILES = ['uv.lock', 'poetry.lock'] as const
const MANIFESTS = ['pyproject.toml', 'requirements.txt'] as const

const SKIPPED_DIRS = new Set([
  'node_modules',
  '__pycache__',
  'site-packages',
  'venv',
  'env',
  'build',
  'dist',
])

const parseVersion = (version: string): number[] =>
  version.split('.').map(part => Number.parseInt(part, 10) || 0)

const compareVersions = (a: number[], b: number[]): number => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    if (x !== y) return x < y ? -1 : 1
  }
  return 0
}

export const majorVersion = (version: string): number => parseVersion(version)[0]

/**
 * Whether a PEP 440 (or Poetry caret) specifier still allows `mcp` 2.3. Only
 * upper bounds and exact pins can rule it out; lower bounds never do here.
 */
export const allowsRequiredMcp = (specifier: string): boolean => {
  const clauses = specifier
    .split(';')[0]
    .split(',')
    .map(clause => clause.trim())
    .filter(Boolean)
  for (const clause of clauses) {
    const match = /^(===|==|~=|<=|<|\^|~|>=|>|!=)?\s*v?([0-9][0-9.*]*)/.exec(clause)
    if (!match) continue
    const op = match[1] ?? '=='
    const raw = match[2]
    if (op === '>=' || op === '>' || op === '!=') continue
    if (raw.includes('*')) {
      const prefix = parseVersion(raw.replace(/\.?\*.*$/, ''))
      const target = REQUIRED_MCP.slice(0, prefix.length)
      if (op === '==' || op === '===') {
        if (compareVersions(prefix, target) !== 0) return false
      }
      continue
    }
    const version = parseVersion(raw)
    if (op === '<' && compareVersions(version, REQUIRED_MCP) <= 0) return false
    if (op === '<=' && compareVersions(version, REQUIRED_MCP) < 0) return false
    if ((op === '==' || op === '===') && compareVersions(version, REQUIRED_MCP) < 0) return false
    if (op === '~=' || op === '^' || op === '~') {
      // ~=1.30 → <2, ~=2.1.0 → <2.2, ^1.30 → <2, ~2.1 → <2.2
      const upper =
        op === '~='
          ? [...version.slice(0, -2), (version[version.length - 2] ?? 0) + 1]
          : op === '^'
            ? [version[0] + 1]
            : [version[0], (version[1] ?? 0) + 1]
      if (compareVersions(upper, REQUIRED_MCP) <= 0) return false
    }
  }
  return true
}

/** Each `mcp` requirement in pyproject.toml or requirements.txt, as written. */
const mcpRequirements = (
  text: string,
  source: string,
): Array<{ requirement: string; spec: string }> => {
  const found: Array<{ requirement: string; spec: string }> = []
  if (source === 'requirements.txt') {
    for (const raw of text.split('\n')) {
      const line = raw.replace(/#.*/, '').trim()
      const match = /^mcp(\[[^\]]*\])?\s*([<>=!~^][^;]*)?(;.*)?$/i.exec(line)
      if (match) found.push({ requirement: line, spec: match[2] ?? '' })
    }
    return found
  }
  // PEP 621 / PEP 735 strings: "mcp[cli]>=1.30,<2"
  for (const match of text.matchAll(
    /["']\s*(mcp(\[[^\]]*\])?\s*([<>=!~][^"';]*)?)\s*(;[^"']*)?["']/gi,
  )) {
    found.push({ requirement: match[1].trim(), spec: match[3] ?? '' })
  }
  // Poetry: mcp = "^1.30" or mcp = { version = "^1.30", extras = [...] }
  for (const match of text.matchAll(
    /^\s*mcp\s*=\s*(?:"([^"]+)"|\{[^}\n]*\bversion\s*=\s*"([^"]+)"[^}\n]*\})/gim,
  )) {
    const spec = match[1] ?? match[2]
    found.push({ requirement: `mcp = "${spec}"`, spec })
  }
  return found
}

const declares = (text: string, pattern: string): boolean =>
  new RegExp(`(^|["'\\s,\\[])${pattern}(\\[[^\\]]*\\])?\\s*([<>=!~^;"',\\]]|$)`, 'im').test(text)

const IMPORT_RULES: Array<{ re: RegExp; module: PythonImport['module'] }> = [
  {
    re: /^\s*(from\s+mcp\.server\.fastmcp\b|import\s+mcp\.server\.fastmcp\b)/,
    module: 'mcp.server.fastmcp',
  },
  {
    re: /^\s*from\s+mcp\.server\s+import\s+[^#]*\b(FastMCP|fastmcp)\b/,
    module: 'mcp.server.fastmcp',
  },
  { re: /^\s*(from|import)\s+fastapi_mcp\b/, module: 'fastapi_mcp' },
  { re: /^\s*(from|import)\s+fastmcp\b/, module: 'fastmcp' },
]

async function* pythonFiles(dir: string): AsyncGenerator<string> {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.') || SKIPPED_DIRS.has(entry.name)) continue
      yield* pythonFiles(path.join(dir, entry.name))
    } else if (entry.isFile() && entry.name.endsWith('.py')) {
      yield path.join(dir, entry.name)
    }
  }
}

/** Imports of `mcp.server.fastmcp`, `fastmcp` and `fastapi_mcp` in the project's own code. */
export const findMcpImports = async (cwd: string): Promise<PythonImport[]> => {
  const hits: PythonImport[] = []
  for await (const file of pythonFiles(cwd)) {
    const text = await readText(file)
    if (text === null) continue
    text.split('\n').forEach((line, index) => {
      const rule = IMPORT_RULES.find(candidate => candidate.re.test(line))
      if (rule) {
        hits.push({
          file: path.relative(cwd, file).split(path.sep).join('/'),
          line: index + 1,
          module: rule.module,
        })
      }
    })
  }
  return hits
}

export const inspectPythonMcpProject = async (cwd: string): Promise<PythonMcpProject> => {
  const project: PythonMcpProject = {
    mcpCaps: [],
    fastapiMcp: [],
    fastmcp: [],
    solvapayMcpExtra: false,
    imports: await findMcpImports(cwd),
  }

  for (const lockfile of LOCKFILES) {
    const lock = await readText(path.join(cwd, lockfile))
    if (lock === null) continue
    const mcp = lockedPackage(lock, 'mcp')
    if (mcp?.version && !project.mcp) project.mcp = { version: mcp.version, source: lockfile }
    if (lockedPackage(lock, 'fastapi-mcp')) project.fastapiMcp.push(lockfile)
    if (lockedPackage(lock, 'fastmcp')) project.fastmcp.push(lockfile)
  }

  for (const manifest of MANIFESTS) {
    const text = await readText(path.join(cwd, manifest))
    if (text === null) continue
    for (const { requirement, spec } of mcpRequirements(text, manifest)) {
      if (!allowsRequiredMcp(spec)) project.mcpCaps.push({ requirement, source: manifest })
      const pinned = /^==\s*([0-9][0-9.]*)\s*$/.exec(spec.trim())
      if (!project.mcp && manifest === 'requirements.txt' && pinned) {
        project.mcp = { version: pinned[1], source: manifest }
      }
    }
    if (declares(text, 'fastapi[-_]mcp') && !project.fastapiMcp.includes(manifest)) {
      project.fastapiMcp.push(manifest)
    }
    if (declares(text, 'fastmcp') && !project.fastmcp.includes(manifest)) {
      project.fastmcp.push(manifest)
    }
    const extras = /(^|["'\s,[])solvapay\[([^\]]+)\]/im.exec(text)?.[2]
    if (extras?.split(',').some(extra => extra.trim() === 'mcp')) project.solvapayMcpExtra = true
  }

  return project
}

const LEGACY_REASON: Record<LegacyModule, string> = {
  'mcp.server.fastmcp': 'which mcp 2.0 removed (FastMCP is now MCPServer)',
  fastapi_mcp: 'which runs only on mcp 1.x',
}

const locations = (imports: PythonImport[]): string => {
  const shown = imports.slice(0, 3).map(hit => `${hit.file}:${hit.line}`)
  const more = imports.length - shown.length
  return `${shown.join(', ')}${more > 0 ? ` and ${more} more` : ''}`
}

/** One line per import site group: `server.py:1 imports mcp.server.fastmcp, which …` */
export const describeLegacyImports = (imports: PythonImport[]): string[] =>
  (['mcp.server.fastmcp', 'fastapi_mcp'] as const)
    .map(module => ({ module, hits: imports.filter(hit => hit.module === module) }))
    .filter(group => group.hits.length > 0)
    .map(
      group => `${locations(group.hits)} imports ${group.module}, ${LEGACY_REASON[group.module]}`,
    )

/**
 * Why installing `solvapay[mcp]` would break this project. Empty when it
 * would not. `solvapay init` stops before sign-in when any are found.
 */
export const pythonMcpBlockers = (project: PythonMcpProject): string[] => {
  const blockers: string[] = []
  if (project.mcp && majorVersion(project.mcp.version) < 2) {
    blockers.push(`${project.mcp.source} locks mcp ${project.mcp.version}`)
  }
  for (const cap of project.mcpCaps) {
    blockers.push(`${cap.source} requires ${cap.requirement}, which rules out mcp 2.3`)
  }
  if (project.fastapiMcp.length > 0) {
    blockers.push(
      `${project.fastapiMcp.join(' and ')} ${project.fastapiMcp.length > 1 ? 'list' : 'lists'} fastapi-mcp, which runs only on mcp 1.x`,
    )
  }
  blockers.push(...describeLegacyImports(project.imports))
  return blockers
}

/** Where the project uses fastmcp, for a warning; empty when it doesn't. */
export const fastmcpUses = (project: PythonMcpProject): string[] => {
  const imports = project.imports.filter(hit => hit.module === 'fastmcp')
  return [...project.fastmcp, ...(imports.length > 0 ? [locations(imports)] : [])]
}
