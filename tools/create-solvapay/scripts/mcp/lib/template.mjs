/* global console */
/**
 * Shared template-copy helpers for `scaffold.mjs`.
 *
 * Provides:
 *   - copyDir(src, dest, { substitutions, skipPaths }) — recursive copy
 *     with placeholder substitution applied to text files.
 *   - substitute(content, table) — straight string replacement using a
 *     `Map<placeholder, value>`.
 *   - PLACEHOLDERS — the literal strings the template ships with that
 *     scaffold replaces at copy time. The full list lives in
 *     `references/tool-template.md` and is the source of truth.
 *
 * Substitution is intentionally string-replace (not template-string
 * interpolation): the template files are valid TypeScript / JSON on
 * their own, so editors and CI lint them without scaffold ever having
 * run.
 */

import { mkdir, readdir, readFile, writeFile, copyFile, stat } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'

/**
 * Literal placeholder strings the template ships with. `scaffold.mjs`
 * substitutes these with values from `selections.json` while copying.
 *
 * Kept here so the template + scaffold contract is observable in code
 * (see also `references/tool-template.md`).
 */
export const PLACEHOLDERS = Object.freeze({
  WORKER_NAME: '__WORKER_NAME__',
  RESOURCE_URI_SLUG: '__RESOURCE_URI_SLUG__',
  SERVER_NAME: '__SERVER_NAME__',
  PRODUCT_REF: '__SOLVAPAY_PRODUCT_REF__',
  PUBLIC_BASE_URL: '__MCP_PUBLIC_BASE_URL__',
})

/**
 * Recursively copy `src` to `dest`. Text files (any file whose
 * extension is in `TEXT_EXTENSIONS` or which has no extension) get
 * placeholder substitution. Binary / unknown files are byte-copied.
 *
 * `skipPaths` is a set of paths (relative to `src`, forward-slash) the
 * caller wants to omit — used to drop the template's example tool when
 * generating into a clean target.
 */
export async function copyDir(src, dest, { substitutions = new Map(), skipPaths = new Set() } = {}) {
  await mkdir(dest, { recursive: true })
  const entries = await readdir(src, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name === '.DS_Store') continue
    const srcPath = join(src, entry.name)
    const relPath = relative(src, srcPath).replaceAll('\\', '/')
    if (skipPaths.has(relPath)) continue
    // npm strips literal `.gitignore` files from published tarballs;
    // ship them as `gitignore` (no dot) and rename at copy time.
    const destName = entry.name === 'gitignore' ? '.gitignore' : entry.name
    const destPath = join(dest, destName)
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath, {
        substitutions,
        skipPaths: scopeSkipPaths(skipPaths, relPath),
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

/**
 * Straight string-replace for every entry in `table`. No regex, no
 * escape handling — placeholders are required to be uniquely shaped
 * (e.g. `__WORKER_NAME__`).
 */
export function substitute(content, table) {
  let out = content
  for (const [placeholder, value] of table) {
    if (typeof value !== 'string') continue
    out = out.split(placeholder).join(value)
  }
  return out
}

/**
 * Apply a mode overlay (e.g. `templates/from-openapi/`) on top of an
 * already-copied `_base/` tree at `target`. Files are walked
 * recursively; each entry is treated as one of:
 *
 *   - `<file>.append`     → append payload to `<file>` (creates if missing).
 *                            Used for `.env.example.append`.
 *   - `<file>.append.md`  → append payload to `<file>.md` (creates if missing).
 *                            Used for `README.append.md`.
 *   - anything else       → straight overwrite at `<relative-path>` under target.
 *
 * Text-payload entries flow through `substitute(...)` so placeholders
 * like `__TOOL_NAME__` resolve before they hit disk.
 */
export async function applyOverlayDir(overlayDir, target, substitutions = new Map()) {
  let entries
  try {
    entries = await readdir(overlayDir, { withFileTypes: true })
  } catch (err) {
    if (err && typeof err === 'object' && err.code === 'ENOENT') return
    throw err
  }
  for (const entry of entries) {
    const srcPath = join(overlayDir, entry.name)
    const destPath = join(target, resolveOverlayDestName(entry.name))
    if (entry.isDirectory()) {
      await applyOverlayDir(srcPath, destPath, substitutions)
      continue
    }
    const isAppend = entry.name.endsWith('.append') || entry.name.endsWith('.append.md')
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

function resolveOverlayDestName(name) {
  if (name.endsWith('.append.md')) return name.slice(0, -'.append.md'.length) + '.md'
  if (name.endsWith('.append')) return name.slice(0, -'.append'.length)
  return name
}

/**
 * Hard-fail if `target` exists. Scaffold is non-idempotent in v1 —
 * users iterate on `selections.json` and re-run into a fresh
 * directory. Idempotent regeneration is an open follow-up.
 */
export async function assertTargetDirAbsent(target) {
  try {
    await stat(target)
  } catch (err) {
    if (err && typeof err === 'object' && err.code === 'ENOENT') return
    throw err
  }
  throw new Error(
    `Refusing to write into existing directory: ${target}. Delete it or pick a fresh target path.`,
  )
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

function isTextFile(name) {
  if (!name.includes('.')) return true
  const lower = name.toLowerCase()
  if (lower.endsWith('.env.example')) return true
  if (lower.startsWith('.env')) return true
  if (lower === '.gitignore' || lower === '.gitattributes') return true
  const dot = lower.lastIndexOf('.')
  return TEXT_EXTENSIONS.has(lower.slice(dot))
}

function scopeSkipPaths(skipPaths, dirRelPath) {
  // Re-scope skipPaths to the subdirectory we're about to recurse into:
  // an entry `src/tools/example.ts` becomes `tools/example.ts` once we
  // step into `src/`.
  const scoped = new Set()
  const prefix = `${dirRelPath}/`
  for (const path of skipPaths) {
    if (path === dirRelPath) continue
    if (path.startsWith(prefix)) scoped.add(path.slice(prefix.length))
  }
  return scoped
}
