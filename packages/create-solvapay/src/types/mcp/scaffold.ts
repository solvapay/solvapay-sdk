/**
 * Shared filesystem + install helpers for the create-solvapay MCP type.
 *
 * The from-openapi mode also reuses these for `_base/` copy + overlay
 * before delegating per-spec codegen to `scripts/mcp/scaffold.mjs`.
 *
 * Path resolution from the compiled `dist/cli.js` uses
 * `fileURLToPath(new URL("../templates/mcp/...", import.meta.url))` so
 * Windows (`file:///C:/...`) is handled correctly. Never use
 * `new URL(...).pathname` slicing — that returns `/C:/...` and breaks
 * downstream `fs` calls once published from npm.
 */

import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdir, readdir, readFile, writeFile, copyFile, stat } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { PackageManager } from '@solvapay/init'

function resolvePackageRoot(startFile: string): string {
  let dir = dirname(startFile)
  while (true) {
    const parent = dirname(dir)
    if (parent === dir) break
    try {
      const raw = readFileSync(join(dir, 'package.json'), 'utf8')
      const pkg = JSON.parse(raw) as { name?: string }
      if (pkg.name === 'create-solvapay') return dir
    } catch {
      // keep walking up
    }
    dir = parent
  }
  throw new Error('Could not locate create-solvapay package root')
}

const PACKAGE_ROOT = resolvePackageRoot(fileURLToPath(import.meta.url))
export const BASE_TEMPLATE_DIR = join(PACKAGE_ROOT, 'templates', 'mcp', '_base')
export const FROM_OPENAPI_OVERLAY_DIR = join(PACKAGE_ROOT, 'templates', 'mcp', 'from-openapi')
export const FROM_SCRATCH_OVERLAY_DIR = join(PACKAGE_ROOT, 'templates', 'mcp', 'from-scratch')
export const SCAFFOLD_SCRIPT_PATH = join(PACKAGE_ROOT, 'scripts', 'mcp', 'scaffold.mjs')

export const PLACEHOLDERS = Object.freeze({
  WORKER_NAME: '__WORKER_NAME__',
  RESOURCE_URI_SLUG: '__RESOURCE_URI_SLUG__',
  SERVER_NAME: '__SERVER_NAME__',
  PRODUCT_REF: '__SOLVAPAY_PRODUCT_REF__',
  PUBLIC_BASE_URL: '__MCP_PUBLIC_BASE_URL__',
  TOOL_NAME: '__TOOL_NAME__',
  TOOL_NAME_PASCAL: '__TOOL_NAME_PASCAL__',
})

/**
 * Derive the MCP `server.info.name` from the project slug. We keep
 * this close to the user's input — lower-case it, swap separators for
 * dashes, drop trailing punctuation — but do not invent extra branding
 * (icon, website, display name). The SDK has a real `branding` option
 * for merchant `brandName` / `iconUrl` / `logoUrl`; we surface that
 * separately so users provide real values rather than scaffold-time
 * placeholders.
 */
export function deriveServerName(projectName: string): string {
  const cleaned = projectName
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
  return cleaned || 'solvapay-mcp-server'
}

/**
 * Capitalize the first character — used to derive `TOOL_NAME_PASCAL`
 * from the user's camelCase input (e.g. `fetchPet` → `FetchPet`) so
 * scaffolded `register<ToolName>` identifiers compile cleanly.
 */
export function pascalize(name: string): string {
  if (!name) return name
  return name.charAt(0).toUpperCase() + name.slice(1)
}

const TEXT_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.cjs',
  '.json',
  '.jsonc',
  '.md',
  '.txt',
  '.html',
  '.css',
  '.yaml',
  '.yml',
  '.toml',
  '.env',
  '.example',
])

function isTextFile(name: string): boolean {
  if (!name.includes('.')) return true
  const lower = name.toLowerCase()
  if (lower.endsWith('.env.example')) return true
  if (lower.startsWith('.env')) return true
  if (lower === '.gitignore' || lower === '.gitattributes') return true
  const dot = lower.lastIndexOf('.')
  return TEXT_EXTENSIONS.has(lower.slice(dot))
}

export function substitute(content: string, table: Map<string, string>): string {
  let out = content
  for (const [placeholder, value] of table) {
    out = out.split(placeholder).join(value)
  }
  return out
}

export async function assertTargetDirAbsent(target: string): Promise<void> {
  try {
    const info = await stat(target)
    if (info.isDirectory()) {
      const entries = await readdir(target)
      const visible = entries.filter(e => !e.startsWith('.DS_Store'))
      if (visible.length === 0) return
    }
  } catch (err) {
    if (err && typeof err === 'object' && (err as NodeJS.ErrnoException).code === 'ENOENT') return
    throw err
  }
  throw new Error(
    `Refusing to write into existing non-empty directory: ${target}. Pick a fresh target path or delete it first.`,
  )
}

type CopyOptions = {
  substitutions?: Map<string, string>
  /**
   * Paths (relative to `src`, forward-slash) to skip during copy. Used
   * to drop the placeholder marker file in from-scratch mode.
   */
  skipPaths?: Set<string>
  /**
   * Rename map applied at copy time: `from-scratch/src/tools/_placeholder.ts`
   * is renamed to `src/tools/<toolName>.ts`. Keys and values are
   * forward-slash relative paths.
   */
  renameMap?: Map<string, string>
}

export async function copyDir(src: string, dest: string, options: CopyOptions = {}): Promise<void> {
  const substitutions = options.substitutions ?? new Map<string, string>()
  const skipPaths = options.skipPaths ?? new Set<string>()
  const renameMap = options.renameMap ?? new Map<string, string>()

  await mkdir(dest, { recursive: true })
  const entries = await readdir(src, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name === '.DS_Store') continue
    const srcPath = join(src, entry.name)
    const relPath = relative(src, srcPath).split('\\').join('/')

    if (skipPaths.has(relPath)) continue

    // npm strips literal `.gitignore` files from published tarballs;
    // ship them as `gitignore` (no dot) and rename at copy time.
    const autoRenamedName = entry.name === 'gitignore' ? '.gitignore' : entry.name
    const renamed = renameMap.get(relPath)
    const destName = renamed ? renamed.split('/').slice(-1)[0] : autoRenamedName
    const destPath = renamed
      ? join(dest, ...renamed.split('/').slice(0, -1), destName)
      : join(dest, autoRenamedName)

    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath, {
        substitutions,
        skipPaths: scopeSkipPaths(skipPaths, relPath),
        renameMap: scopeRenameMap(renameMap, relPath),
      })
      continue
    }

    if (isTextFile(entry.name)) {
      const content = await readFile(srcPath, 'utf8')
      await mkdir(dirname(destPath), { recursive: true })
      await writeFile(destPath, substitute(content, substitutions), 'utf8')
    } else {
      await mkdir(dirname(destPath), { recursive: true })
      await copyFile(srcPath, destPath)
    }
  }
}

function scopeSkipPaths(skipPaths: Set<string>, dirRelPath: string): Set<string> {
  const scoped = new Set<string>()
  const prefix = `${dirRelPath}/`
  for (const path of skipPaths) {
    if (path === dirRelPath) continue
    if (path.startsWith(prefix)) scoped.add(path.slice(prefix.length))
  }
  return scoped
}

function scopeRenameMap(renameMap: Map<string, string>, dirRelPath: string): Map<string, string> {
  const scoped = new Map<string, string>()
  const prefix = `${dirRelPath}/`
  for (const [from, to] of renameMap) {
    if (!from.startsWith(prefix)) continue
    if (!to.startsWith(prefix)) continue
    scoped.set(from.slice(prefix.length), to.slice(prefix.length))
  }
  return scoped
}

/**
 * Apply a mode overlay (e.g. `templates/from-scratch/`) on top of an
 * already-copied `_base` tree at `target`. Overlay rules:
 *
 *   - `<file>.append`     → append payload to `<file>` (creates if missing).
 *   - `<file>.append.md`  → append payload to `<file>.md`.
 *   - everything else     → straight overwrite (with placeholder substitution
 *                            for text files).
 */
export async function applyOverlay(
  overlayDir: string,
  target: string,
  options: CopyOptions = {},
): Promise<void> {
  const substitutions = options.substitutions ?? new Map<string, string>()
  const renameMap = options.renameMap ?? new Map<string, string>()

  let entries
  try {
    entries = await readdir(overlayDir, { withFileTypes: true })
  } catch (err) {
    if (err && typeof err === 'object' && (err as NodeJS.ErrnoException).code === 'ENOENT') return
    throw err
  }
  for (const entry of entries) {
    if (entry.name === '.DS_Store') continue
    const srcPath = join(overlayDir, entry.name)
    const relPath = entry.name

    if (entry.isDirectory()) {
      const subTarget = join(target, entry.name)
      await applyOverlay(srcPath, subTarget, {
        substitutions,
        renameMap: scopeRenameMap(renameMap, relPath),
      })
      continue
    }

    const isAppend = entry.name.endsWith('.append') || entry.name.endsWith('.append.md')
    const renamed = renameMap.get(relPath)
    const destName = renamed ?? resolveOverlayDestName(entry.name)
    const destPath = join(target, destName)

    if (isTextFile(entry.name) || isAppend) {
      const payload = substitute(await readFile(srcPath, 'utf8'), substitutions)
      await mkdir(dirname(destPath), { recursive: true })
      if (isAppend) {
        let existing = ''
        try {
          existing = await readFile(destPath, 'utf8')
        } catch {
          existing = ''
        }
        const joiner = existing && !existing.endsWith('\n') ? '\n' : ''
        await writeFile(destPath, `${existing}${joiner}${payload}`, 'utf8')
      } else {
        await writeFile(destPath, payload, 'utf8')
      }
    } else {
      await mkdir(dirname(destPath), { recursive: true })
      await copyFile(srcPath, destPath)
    }
  }
}

function resolveOverlayDestName(name: string): string {
  if (name.endsWith('.append.md')) return name.slice(0, -'.append.md'.length) + '.md'
  if (name.endsWith('.append')) return name.slice(0, -'.append'.length)
  return name
}

export async function writeBootstrapEnv(target: string, productRef: string): Promise<void> {
  const envPath = join(target, '.env')
  const lines = [
    '# Created by create-solvapay. Secrets land here from `solvapay init`.',
    `SOLVAPAY_PRODUCT_REF=${productRef}`,
    'MCP_PUBLIC_BASE_URL=http://localhost:8787',
  ]
  await writeFile(envPath, `${lines.join('\n')}\n`, 'utf8')
}

/**
 * Initialize a git repo in `target` if one is not already present.
 * Best-effort: missing `git` binary or any failure is logged and
 * swallowed — the rest of the scaffold flow does not depend on this.
 *
 * Skips when `target/.git` exists, when running inside an existing
 * git work tree, or when the user passed `--no-git` (handled at the
 * call site by simply not calling this).
 */
export async function gitInit(target: string): Promise<void> {
  try {
    await stat(join(target, '.git'))
    return
  } catch {
    // .git missing — proceed.
  }

  await new Promise<void>(resolve => {
    const child = spawn('git', ['init', '--quiet'], {
      cwd: target,
      stdio: 'ignore',
      shell: process.platform === 'win32',
    })
    child.once('error', () => resolve())
    child.once('close', () => resolve())
  })
}

const LOCAL_WORKER_URL = 'http://localhost:8787'

type ConnectionSnippetsOptions = {
  projectName: string
  workerUrl?: string
}

/**
 * Print copy-paste connection snippets for the four common MCP clients
 * after a scaffold finishes. Native-scheme hosts (Cursor, Claude Desktop)
 * can point at `http://localhost:8787/` directly; remote / browser
 * hosts (ChatGPT, Inspector web UI) need a reachable URL — we call that
 * out rather than pretending localhost works everywhere.
 */
export function printConnectionSnippets(options: ConnectionSnippetsOptions): void {
  const { projectName, workerUrl = LOCAL_WORKER_URL } = options
  const out = (line: string): void => {
    process.stdout.write(`${line}\n`)
  }

  out('')
  out('🔌 Connect an MCP client:')
  out('')
  out(`   Cursor — add to \`~/.cursor/mcp.json\` (or the workspace's \`.cursor/mcp.json\`):`)
  out('     {')
  out('       "mcpServers": {')
  out(`         "${projectName}": { "url": "${workerUrl}/" }`)
  out('       }')
  out('     }')
  out('')
  out(`   Claude Desktop — add to \`claude_desktop_config.json\`:`)
  out('     {')
  out('       "mcpServers": {')
  out(`         "${projectName}": {`)
  out('           "command": "npx",')
  out(`           "args": ["mcp-remote", "${workerUrl}/"]`)
  out('         }')
  out('       }')
  out('     }')
  out('')
  out('   ChatGPT (Custom Connectors) — add a Custom MCP Connector with:')
  out(`     URL: ${workerUrl}/`)
  out('     Note: ChatGPT needs a reachable (deployed or tunneled) URL —')
  out('     localhost only works for native-scheme hosts. Use `npm run deploy`')
  out('     and point ChatGPT at the *.workers.dev URL once available.')
  out('')
  out('   MCP Inspector — explore tools locally:')
  out('     npx @modelcontextprotocol/inspector')
  out(`     (set the server URL to ${workerUrl}/)`)
  out('')
}

export type InstallProgress = (message: string) => void

export type InstallProjectResult = {
  ok: boolean
  command: string
  warning?: string
}

/**
 * Run a project-local `<pm> install` inside `cwd`. Distinct from
 * `installSolvaPaySdk` in @solvapay/init because here we install the scaffolded
 * `package.json` (MCP deps, wrangler, vite, etc.) rather than the SolvaPay
 * base packages.
 */
export async function installProjectDependencies(
  packageManager: PackageManager,
  cwd: string,
  onProgress?: InstallProgress,
): Promise<InstallProjectResult> {
  const args = ['install']
  const command = `${packageManager} install`
  onProgress?.('Resolving packages')

  return new Promise(resolve => {
    const child = spawn(packageManager, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    })

    const errorLines: string[] = []
    const handleChunk = (chunk: Buffer): void => {
      const text = chunk.toString('utf8')
      const lines = text.split(/\r?\n|\r/g)
      for (const line of lines) {
        if (!line.trim()) continue
        errorLines.push(line.trim())
        if (errorLines.length > 30) errorLines.shift()
      }
    }

    child.stdout?.on('data', handleChunk)
    child.stderr?.on('data', handleChunk)

    child.once('error', error => {
      resolve({ ok: false, command, warning: error.message })
    })

    child.once('close', code => {
      if (code === 0) {
        resolve({ ok: true, command })
        return
      }
      resolve({
        ok: false,
        command,
        warning: `${command} exited with code ${code ?? 'unknown'}${
          errorLines.length ? `\n${errorLines.slice(-10).join('\n')}` : ''
        }`,
      })
    })
  })
}
