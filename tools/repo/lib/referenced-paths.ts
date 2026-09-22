/**
 * Collect repo-root-relative layout paths referenced from package.json,
 * GitHub Actions (`run:`, `working-directory:`, `with.path:`), husky hooks,
 * pnpm-workspace.yaml, .gitignore, and Cargo members / path deps.
 *
 * Token vocabulary is derived from `contract/manifest/repo-paths.yaml`
 * (`dirs` + `sdks`) plus dissolved top-level names (`scripts`, and `rust`
 * once that tree is gone). Workflow `run:` tokens resolve against the step's
 * `working-directory`, falling back to the job's `defaults.run.working-directory`.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import { REPO_ROOT, WORKFLOWS_DIR } from '../../shared/paths.js'
import { loadRepoPathsManifest } from '../../shared/repo-paths.js'

export type PathReference = {
  source: string
  raw: string
  resolved: string
}

const IMPORTERS = [
  'sdks/typescript/core/vitest.config.ts',
  'tools/init/vitest.config.ts',
  'sdks/typescript/react/vitest.config.ts',
  'examples/typescript/checkout-demo/vitest.config.ts',
  'sdks/typescript/server/scripts/generate-types.ts',
  'sdks/typescript/mcp-core/scripts/deno-edge-smoke.mjs',
] as const

const SKIP_TOKEN = /\$|\{\{/

/** Top-level directories that used to exist and must not be referenced. */
const DISSOLVED_ROOTS = ['scripts', 'packages'] as const

const FROM_IMPORT = /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g
const CARGO_PATH = /path\s*=\s*"([^"]+)"/g
const CARGO_MEMBER_LINE = /^\s*"([^"]+)"\s*,?\s*$/

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function posixRel(abs: string): string {
  return path.relative(REPO_ROOT, abs).split(path.sep).join('/')
}

function layoutPrefixes(): string[] {
  const manifest = loadRepoPathsManifest()
  const prefixes = new Set<string>(DISSOLVED_ROOTS)
  if (!('rust' in manifest.dirs)) {
    prefixes.add('rust')
  }
  for (const rel of [...Object.values(manifest.dirs), ...Object.values(manifest.sdks)]) {
    const top = rel.split('/')[0]
    if (top !== undefined && top.length > 0) {
      prefixes.add(top)
    }
  }
  return [...prefixes].sort((a, b) => b.length - a.length)
}

function layoutTokenRegex(): RegExp {
  const escaped = layoutPrefixes().map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  return new RegExp(
    `(?:^|[\\s='"([,])((?:\\.\\.?\\/)*(?:${escaped.join('|')})(?:\\/[^\\s'"\\\\)]+)?)`,
    'g',
  )
}

export function isUnderLegacyDir(abs: string): boolean {
  const rel = posixRel(abs)
  const roots: readonly string[] = DISSOLVED_ROOTS
  const extra = 'rust' in loadRepoPathsManifest().dirs ? [] : (['rust'] as const)
  for (const root of [...roots, ...extra]) {
    if (rel === root || rel.startsWith(`${root}/`)) {
      return true
    }
  }
  return false
}

/** @deprecated Use {@link isUnderLegacyDir}. */
export const isTopLevelScripts = isUnderLegacyDir

function shouldSkipToken(token: string): boolean {
  return SKIP_TOKEN.test(token)
}

function stripGlob(token: string): string {
  const cut = token.search(/[*?[]/)
  if (cut === -1) {
    return token.replace(/\/$/, '')
  }
  return token.slice(0, cut).replace(/\/$/, '')
}

function extractLayoutTokens(text: string): string[] {
  const found: string[] = []
  const re = layoutTokenRegex()
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    const token = match[1]
    if (token === undefined || shouldSkipToken(token)) {
      continue
    }
    const cleaned = stripGlob(token)
    if (cleaned.length > 0) {
      found.push(cleaned)
    }
  }
  return found
}

function extractImportSpecifiers(text: string): string[] {
  const found: string[] = []
  const prefixes = layoutPrefixes()
  FROM_IMPORT.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = FROM_IMPORT.exec(text)) !== null) {
    const spec = match[1]
    if (spec === undefined || shouldSkipToken(spec)) {
      continue
    }
    if (
      prefixes.some(
        p => spec.includes(`/${p}/`) || spec.startsWith(`${p}/`) || spec.includes(`/${p}`),
      )
    ) {
      found.push(spec)
    }
  }
  return found
}

function resolveExisting(abs: string): string {
  if (existsSync(abs)) {
    return abs
  }
  if (abs.endsWith('.js')) {
    const ts = abs.slice(0, -3) + '.ts'
    if (existsSync(ts)) {
      return ts
    }
    const mjs = abs.slice(0, -3) + '.mjs'
    if (existsSync(mjs)) {
      return mjs
    }
  }
  for (const ext of ['.ts', '.js', '.mjs']) {
    const candidate = abs + ext
    if (existsSync(candidate)) {
      return candidate
    }
  }
  let cur = abs
  while (!existsSync(cur)) {
    const parent = path.dirname(cur)
    if (parent === cur) {
      return abs
    }
    cur = parent
  }
  return cur
}

function workflowWorkingDirectory(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || shouldSkipToken(value) || value === '.') {
    return fallback
  }
  return path.resolve(REPO_ROOT, value)
}

function pushRef(acc: PathReference[], source: string, raw: string, resolved: string): void {
  acc.push({ source, raw, resolved: resolveExisting(resolved) })
}

function collectFromPackageJson(acc: PathReference[]): void {
  const pkgPath = path.join(REPO_ROOT, 'package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
    scripts?: Record<string, string>
  }
  for (const [name, command] of Object.entries(pkg.scripts ?? {})) {
    for (const token of extractLayoutTokens(command)) {
      pushRef(acc, `package.json scripts.${name}`, token, path.resolve(REPO_ROOT, token))
    }
  }
}

function collectFromImporters(acc: PathReference[]): void {
  for (const rel of IMPORTERS) {
    const abs = path.join(REPO_ROOT, ...rel.split('/'))
    const src = readFileSync(abs, 'utf8')
    const dir = path.dirname(abs)
    for (const spec of extractImportSpecifiers(src)) {
      pushRef(acc, rel, spec, path.resolve(dir, spec))
    }
  }
}

function collectWithPath(acc: PathReference[], source: string, value: unknown): void {
  if (typeof value === 'string') {
    if (shouldSkipToken(value)) {
      return
    }
    for (const line of value.split('\n')) {
      const trimmed = line.trim()
      if (trimmed === '' || shouldSkipToken(trimmed)) {
        continue
      }
      const token = stripGlob(trimmed)
      if (token === '' || token === '.') {
        continue
      }
      if (
        extractLayoutTokens(token).length === 0 &&
        !layoutPrefixes().some(p => token === p || token.startsWith(`${p}/`))
      ) {
        continue
      }
      pushRef(acc, source, token, path.resolve(REPO_ROOT, token))
    }
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectWithPath(acc, source, item)
    }
  }
}

function collectJobRuns(
  acc: PathReference[],
  workflowRel: string,
  jobId: string,
  job: Record<string, unknown>,
): void {
  let jobCwd = REPO_ROOT
  if (isPlainObject(job.defaults) && isPlainObject(job.defaults.run)) {
    const wd = job.defaults.run['working-directory']
    if (typeof wd === 'string' && !shouldSkipToken(wd) && wd !== '.') {
      pushRef(
        acc,
        `${workflowRel} jobs.${jobId} defaults.run.working-directory`,
        wd,
        path.resolve(REPO_ROOT, wd),
      )
    }
    jobCwd = workflowWorkingDirectory(wd, REPO_ROOT)
  }
  const steps = job.steps
  if (!Array.isArray(steps)) {
    return
  }
  for (const [index, step] of steps.entries()) {
    if (!isPlainObject(step)) {
      continue
    }
    const stepSource = `${workflowRel} jobs.${jobId} steps[${index}]`
    if (typeof step['working-directory'] === 'string') {
      const wd = step['working-directory']
      if (!shouldSkipToken(wd) && wd !== '.') {
        pushRef(acc, `${stepSource} working-directory`, wd, path.resolve(REPO_ROOT, wd))
      }
    }
    if (isPlainObject(step.with) && 'path' in step.with) {
      collectWithPath(acc, `${stepSource} with.path`, step.with.path)
    }
    if (typeof step.run !== 'string') {
      continue
    }
    const stepCwd = workflowWorkingDirectory(step['working-directory'], jobCwd)
    for (const token of extractLayoutTokens(step.run)) {
      pushRef(acc, stepSource, token, path.resolve(stepCwd, token))
    }
  }
}

function collectFromWorkflows(acc: PathReference[]): void {
  for (const name of readdirSync(WORKFLOWS_DIR)) {
    if (!name.endsWith('.yml') && !name.endsWith('.yaml')) {
      continue
    }
    const abs = path.join(WORKFLOWS_DIR, name)
    const rel = path.posix.join('.github/workflows', name)
    const raw: unknown = parseYaml(readFileSync(abs, 'utf8'))
    if (!isPlainObject(raw) || !isPlainObject(raw.jobs)) {
      continue
    }
    for (const [jobId, job] of Object.entries(raw.jobs)) {
      if (!isPlainObject(job)) {
        continue
      }
      collectJobRuns(acc, rel, jobId, job)
    }
  }
}

function collectFromHusky(acc: PathReference[]): void {
  const huskyDir = path.join(REPO_ROOT, '.husky')
  if (!existsSync(huskyDir)) {
    return
  }
  for (const name of readdirSync(huskyDir)) {
    const abs = path.join(huskyDir, name)
    if (!statSync(abs).isFile()) {
      continue
    }
    const rel = path.posix.join('.husky', name)
    const text = readFileSync(abs, 'utf8')
    for (const token of extractLayoutTokens(text)) {
      pushRef(acc, rel, token, path.resolve(REPO_ROOT, token))
    }
  }
}

function collectFromPnpmWorkspace(acc: PathReference[]): void {
  const file = path.join(REPO_ROOT, 'pnpm-workspace.yaml')
  const raw: unknown = parseYaml(readFileSync(file, 'utf8'))
  if (!isPlainObject(raw) || !Array.isArray(raw.packages)) {
    return
  }
  for (const entry of raw.packages) {
    if (typeof entry !== 'string') {
      continue
    }
    const token = stripGlob(entry)
    if (token === '' || shouldSkipToken(token)) {
      continue
    }
    pushRef(acc, 'pnpm-workspace.yaml', entry, path.resolve(REPO_ROOT, token))
  }
}

function collectFromGitignore(acc: PathReference[]): void {
  const file = path.join(REPO_ROOT, '.gitignore')
  const prefixes = layoutPrefixes()
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#') || trimmed.startsWith('!')) {
      continue
    }
    const token = stripGlob(trimmed.replace(/^\//, ''))
    if (token === '' || shouldSkipToken(token)) {
      continue
    }
    if (!prefixes.some(p => token === p || token.startsWith(`${p}/`))) {
      continue
    }
    pushRef(acc, '.gitignore', trimmed, path.resolve(REPO_ROOT, token))
  }
}

function walkFiles(dir: string, acc: string[], basename: string): void {
  if (!existsSync(dir)) {
    return
  }
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'target' || name === '.git' || name === 'dist') {
      continue
    }
    const full = path.join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) {
      walkFiles(full, acc, basename)
      continue
    }
    if (name === basename) {
      acc.push(full)
    }
  }
}

function collectMembers(text: string): string[] {
  const members: string[] = []
  const block = text.match(/members\s*=\s*\[([\s\S]*?)\]/)
  if (block === null || block[1] === undefined) {
    return members
  }
  for (const line of block[1].split('\n')) {
    const match = CARGO_MEMBER_LINE.exec(line)
    if (match?.[1] !== undefined) {
      members.push(match[1])
    }
  }
  return members
}

function collectFromCargo(acc: PathReference[]): void {
  const files: string[] = []
  walkFiles(REPO_ROOT, files, 'Cargo.toml')
  for (const abs of files) {
    const rel = posixRel(abs)
    const dir = path.dirname(abs)
    const text = readFileSync(abs, 'utf8')
    for (const member of collectMembers(text)) {
      if (member === '.') {
        continue
      }
      pushRef(acc, rel, member, path.resolve(dir, member))
    }
    CARGO_PATH.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = CARGO_PATH.exec(text)) !== null) {
      const token = match[1]
      if (token === undefined || shouldSkipToken(token)) {
        continue
      }
      pushRef(acc, rel, token, path.resolve(dir, token))
    }
  }
}

export function collectReferencedPaths(): PathReference[] {
  const acc: PathReference[] = []
  collectFromPackageJson(acc)
  collectFromWorkflows(acc)
  collectFromImporters(acc)
  collectFromHusky(acc)
  collectFromPnpmWorkspace(acc)
  collectFromGitignore(acc)
  collectFromCargo(acc)
  return acc
}
