/**
 * Manual pre-merge audit for origin/dev commits that landed on paths this
 * branch deleted in the layout remap (ee190801). Git treats those merges as
 * already applied, so a later dev edit can vanish without a conflict.
 *
 * For each mapped file change since the remap, prettier-normalize both sides
 * and the current tree, then probe:
 *
 * - reverse applies: the change is present
 * - forward applies, and the inserted lines are still in origin/dev's tip
 *   but missing here: confirmed drop
 * - forward applies, but a later dev commit removed those lines: review
 *   (an intermediate patch, not a drop)
 * - the rewritten file already matches the dev tip: present, history ignored
 * - neither apply: the file diverged; review by hand
 *
 * Not a CI gate — drift is expected on a long-lived branch. Exits 1 when any
 * confirmed drop remains.
 *
 *   pnpm sync:audit
 */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import prettier from 'prettier'
import { REPO_ROOT } from '../shared/paths.js'
import { isDirectRun, parseErrorResult, runScriptMain, type CliResult } from '../codegen/lib/cli.js'

/** Layout commit that moved `packages/*` off the paths origin/dev still uses. */
export const DEV_SYNC_SINCE = 'ee190801'

const TS_PACKAGES = new Set([
  'auth',
  'core',
  'mcp',
  'mcp-core',
  'next',
  'react',
  'react-supabase',
  'server',
])

const TOOL_PACKAGES = new Set(['cli', 'create-solvapay', 'init'])

const INTERNAL_PACKAGES = new Set(['demo-services', 'test-utils', 'tsconfig'])

/**
 * Dev paths this branch removed on purpose. They must not surface as drops:
 * the replacement lives somewhere `rewriteDevPath` cannot point at.
 */
const DELIBERATELY_DELETED = new Set(['examples/cloudflare-workers-mcp/scripts/preflight-dev.mjs'])

/**
 * Dev hunks ported with an intentional rewrite. They must not surface as
 * drops: the behavior is on this branch, the bytes are not.
 *
 * - `packages/init/src/env.ts` — non-TTY overwrite throws; dev calls `process.exit`.
 * - `packages/init/src/run-init.test.ts` — tests assert `{ cwd, yes }` rather than
 *   a `confirmOverwrite` closure.
 */
const ACCEPTED_REWRITES = new Set([
  '4f5a484721b8:packages/init/src/env.ts',
  '4f5a484721b8:packages/init/src/run-init.test.ts',
])

export function isAcceptedRewrite(commit: string, devPath: string): boolean {
  return ACCEPTED_REWRITES.has(`${commit.slice(0, 12)}:${devPath}`)
}

export type AuditKind = 'present' | 'missing' | 'review'

export type AuditFinding = {
  kind: AuditKind
  commit: string
  subject: string
  devPath: string
  rewrittenPath: string
  hunk: string
}

export type NameStatusEntry = {
  status: string
  path: string
  oldPath?: string
}

type GitResult = {
  status: number
  stdout: Buffer
  stderr: string
}

/**
 * Historical dev path → path on this branch.
 * Returns null for paths the remap does not own.
 */
export function rewriteDevPath(devPath: string): string | null {
  if (DELIBERATELY_DELETED.has(devPath)) return null
  const parts = devPath.split('/')
  const head = parts[0]
  if (head === 'packages' && parts.length >= 2) {
    const name = parts[1] ?? ''
    const rest = parts.slice(2).join('/')
    const suffix = rest.length > 0 ? `/${rest}` : ''
    if (TS_PACKAGES.has(name)) return `sdks/typescript/${name}${suffix}`
    if (TOOL_PACKAGES.has(name)) {
      const rewritten = `tools/${name}${suffix}`
      if (name === 'create-solvapay') {
        return rewritten.replace('/templates/mcp/_base/', '/templates/mcp/ts/_base/')
      }
      return rewritten
    }
    if (INTERNAL_PACKAGES.has(name)) return `internal/${name}${suffix}`
    return null
  }
  if (head === 'examples' && parts.length >= 2 && parts[1] !== 'typescript') {
    return `examples/typescript/${parts.slice(1).join('/')}`
  }
  return null
}

/** Parse `git diff-tree -z --name-status` output, including rename pairs. */
export function parseNameStatus(raw: string): NameStatusEntry[] {
  const parts = raw.split('\0').filter(part => part.length > 0)
  const entries: NameStatusEntry[] = []
  let index = 0
  while (index < parts.length) {
    const status = parts[index]
    index += 1
    if (status === undefined) break
    if (status.startsWith('R') || status.startsWith('C')) {
      const oldPath = parts[index]
      const newPath = parts[index + 1]
      index += 2
      if (oldPath !== undefined && newPath !== undefined) {
        entries.push({ status, path: newPath, oldPath })
      }
      continue
    }
    const filePath = parts[index]
    index += 1
    if (filePath !== undefined) {
      entries.push({ status, path: filePath })
    }
  }
  return entries
}

function git(args: string[], cwd: string): GitResult {
  const result = spawnSync('git', args, {
    cwd,
    maxBuffer: 64 * 1024 * 1024,
  })
  if (result.error) {
    throw result.error
  }
  const stdout = result.stdout ?? Buffer.alloc(0)
  const stderr = (result.stderr ?? Buffer.alloc(0)).toString('utf8')
  return { status: result.status ?? 1, stdout, stderr }
}

function gitText(args: string[], cwd: string): string {
  const result = git(args, cwd)
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`)
  }
  return result.stdout.toString('utf8')
}

function isBinary(buf: Buffer): boolean {
  return buf.includes(0)
}

function showBlob(spec: string, cwd: string): Buffer {
  const result = git(['show', spec], cwd)
  if (result.status !== 0) {
    throw new Error(`git show ${spec} failed: ${result.stderr.trim()}`)
  }
  return result.stdout
}

export function retargetPatch(diff: string, rewrittenPath: string): string {
  const lines = diff.split('\n')
  const hunkAt = lines.findIndex(line => line.startsWith('@@'))
  const headerEnd = hunkAt === -1 ? lines.length : hunkAt
  const header = lines.slice(0, headerEnd).map(line => {
    if (line.startsWith('diff --git ')) {
      return `diff --git a/${rewrittenPath} b/${rewrittenPath}`
    }
    if (line.startsWith('--- a/') || line.startsWith('+++ b/')) {
      const prefix = line.startsWith('---') ? '--- a/' : '+++ b/'
      return `${prefix}${rewrittenPath}`
    }
    return line
  })
  return [...header, ...lines.slice(headerEnd)].join('\n')
}

export function splitPatchHunks(patch: string): string[] {
  const normalized = patch.endsWith('\n') ? patch : `${patch}\n`
  if (normalized.includes('new file mode ') || normalized.includes('deleted file mode ')) {
    return [normalized]
  }
  const lines = normalized.slice(0, -1).split('\n')
  const firstHunk = lines.findIndex(line => line.startsWith('@@'))
  if (firstHunk < 0) return []
  const header = lines.slice(0, firstHunk)
  const groups: string[][] = []
  let current: string[] | null = null
  for (const line of lines.slice(firstHunk)) {
    if (line.startsWith('@@')) {
      if (current) groups.push(current)
      current = []
    }
    current?.push(line)
  }
  if (current) groups.push(current)
  return groups
    .filter(group =>
      group.some(
        line =>
          (line.startsWith('+') || line.startsWith('-')) &&
          !line.startsWith('+++') &&
          !line.startsWith('---'),
      ),
    )
    .map(group => `${[...header, ...group].join('\n')}\n`)
}

function contentPatch(
  oldText: string | null,
  newText: string | null,
  rewrittenPath: string,
): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'dev-sync-diff-'))
  try {
    const oldArg = oldText === null ? '/dev/null' : 'before'
    const newArg = newText === null ? '/dev/null' : 'after'
    if (oldText !== null) writeFileSync(path.join(dir, 'before'), oldText)
    if (newText !== null) writeFileSync(path.join(dir, 'after'), newText)
    const result = git(['diff', '--no-index', '--text', '--', oldArg, newArg], dir)
    if (result.status !== 0 && result.status !== 1) {
      throw new Error(`git diff --no-index failed: ${result.stderr.trim()}`)
    }
    const raw = result.stdout.toString('utf8')
    if (raw.trim().length === 0) return ''
    const retargeted = retargetPatch(raw, rewrittenPath)
    return retargeted.endsWith('\n') ? retargeted : `${retargeted}\n`
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function hunkHeader(patch: string): string {
  const line = patch.split('\n').find(entry => entry.startsWith('@@'))
  return line ?? '(file)'
}

function lineRuns(patch: string, marker: '+' | '-'): string[] {
  const hunkAt = patch.indexOf('\n@@')
  const body = hunkAt === -1 ? '' : patch.slice(hunkAt + 1)
  const runs: string[][] = []
  let current: string[] | null = null
  for (const line of body.split('\n')) {
    if (line.startsWith(marker)) {
      current ??= []
      current.push(line.slice(1))
      continue
    }
    if (current) {
      runs.push(current)
      current = null
    }
  }
  if (current) runs.push(current)
  return runs.map(run => run.join('\n')).filter(run => run.trim().length > 0)
}

/**
 * A forward-applicable hunk is a real drop only when dev's tip still has the
 * inserted text (or still lacks the deleted text) and the current tree does not.
 * Intermediate commits that dev later reverted are not drops.
 */
export function dropStillAtTip(
  patch: string,
  tipText: string | null,
  currentText: string | null,
): boolean {
  const added = lineRuns(patch, '+')
  if (added.length > 0) {
    if (tipText === null) return false
    const survived = added.every(run => tipText.includes(run))
    const missingHere = currentText === null || added.some(run => !currentText.includes(run))
    return survived && missingHere
  }
  const removed = lineRuns(patch, '-')
  if (removed.length === 0) return false
  const goneFromTip = tipText === null || removed.every(run => !tipText.includes(run))
  const stillHere = currentText !== null && removed.some(run => currentText.includes(run))
  return goneFromTip && stillHere
}

/**
 * Probe one normalized change. `null` means the file does not exist on that
 * side (added, deleted, or absent from the current tree) — distinct from "".
 */
export function classifyNormalizedTexts(input: {
  oldText: string | null
  newText: string | null
  currentText: string | null
  /** Dev tip for this path. Defaults to `newText` (this commit is the tip). */
  tipText?: string | null
  rewrittenPath: string
}): Array<{ kind: AuditKind; hunk: string }> {
  const { oldText, newText, currentText, rewrittenPath } = input
  const tipText = input.tipText === undefined ? newText : input.tipText
  if (oldText === newText) return []
  if (currentText === newText || currentText === tipText) {
    return [{ kind: 'present', hunk: '(file)' }]
  }
  if (currentText === oldText && tipText === newText) {
    return [{ kind: 'missing', hunk: '(file)' }]
  }

  const patch = contentPatch(oldText, newText, rewrittenPath)
  const hunks = splitPatchHunks(patch)
  if (hunks.length === 0) return []
  return hunks.map(hunk => {
    const kind = probePatch(hunk, rewrittenPath, currentText)
    if (kind !== 'missing') return { kind, hunk: hunkHeader(hunk) }
    return {
      kind: dropStillAtTip(hunk, tipText, currentText) ? 'missing' : 'review',
      hunk: hunkHeader(hunk),
    }
  })
}

export function probePatch(
  patch: string,
  rewrittenPath: string,
  currentText: string | null,
): AuditKind {
  const dir = mkdtempSync(path.join(tmpdir(), 'dev-sync-probe-'))
  try {
    if (currentText !== null) {
      const abs = path.join(dir, rewrittenPath)
      mkdirSync(path.dirname(abs), { recursive: true })
      writeFileSync(abs, currentText)
    }
    const patchFile = path.join(dir, 'change.patch')
    writeFileSync(patchFile, patch)
    const reverse = git(
      ['apply', '--check', '--reverse', '-C100', '--unsafe-paths', patchFile],
      dir,
    )
    if (reverse.status === 0) return 'present'
    const forward = git(['apply', '--check', '-C100', '--unsafe-paths', patchFile], dir)
    if (forward.status === 0) return 'missing'
    return 'review'
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

type FormatCache = Map<string, string>

export async function normalizeTrackedSource(
  text: string,
  filepath: string,
  repoRoot: string,
): Promise<string> {
  return normalizeText(text, filepath, repoRoot, new Map())
}

async function normalizeText(
  text: string,
  filepath: string,
  repoRoot: string,
  cache: FormatCache,
): Promise<string> {
  const key = `${filepath}\0${createHash('sha256').update(text).digest('hex')}`
  const cached = cache.get(key)
  if (cached !== undefined) return cached
  const abs = path.join(repoRoot, filepath)
  let formatted = text
  try {
    const info = await prettier.getFileInfo(abs, {
      ignorePath: path.join(repoRoot, '.prettierignore'),
      resolveConfig: false,
    })
    if (!info.ignored && info.inferredParser !== null) {
      const config = await prettier.resolveConfig(abs, { editorconfig: false })
      formatted = await prettier.format(text, { ...config, filepath: abs })
    }
  } catch {
    // A file prettier cannot parse still has to be probed. Raw text keeps
    // the three sides comparable; it does not hide a drop.
    formatted = text
  }
  cache.set(key, formatted)
  return formatted
}

function loadSide(
  commit: string,
  filePath: string,
  exists: boolean,
  repoRoot: string,
): Buffer | null {
  if (!exists) return null
  return showBlob(`${commit}:${filePath}`, repoRoot)
}

function parentSpec(commit: string): string {
  return `${commit}^`
}

export async function auditDevSync(options: {
  repoRoot: string
  since: string
  ref: string
}): Promise<AuditFinding[]> {
  const { repoRoot, since, ref } = options
  const log = gitText(
    [
      'log',
      '--reverse',
      '--no-merges',
      '--format=%H%x09%s',
      `${since}..${ref}`,
      '--',
      'packages',
      'examples',
    ],
    repoRoot,
  )
  const commits = log
    .split('\n')
    .filter(line => line.length > 0)
    .map(line => {
      const tab = line.indexOf('\t')
      return { commit: line.slice(0, tab), subject: line.slice(tab + 1) }
    })

  const cache: FormatCache = new Map()
  const findings: AuditFinding[] = []
  const tipByPath = new Map<string, string | null>()
  const currentByPath = new Map<string, string | null>()

  async function readTip(devPath: string, rewrittenPath: string): Promise<string | null> {
    const cached = tipByPath.get(devPath)
    if (cached !== undefined) return cached
    const shown = git(['show', `${ref}:${devPath}`], repoRoot)
    if (shown.status !== 0 || isBinary(shown.stdout)) {
      tipByPath.set(devPath, null)
      return null
    }
    const text = await normalizeText(shown.stdout.toString('utf8'), rewrittenPath, repoRoot, cache)
    tipByPath.set(devPath, text)
    return text
  }

  async function readCurrent(rewrittenPath: string): Promise<string | null> {
    const cached = currentByPath.get(rewrittenPath)
    if (cached !== undefined) return cached
    const currentAbs = path.join(repoRoot, rewrittenPath)
    if (!existsSync(currentAbs)) {
      currentByPath.set(rewrittenPath, null)
      return null
    }
    const text = await normalizeText(
      readFileSync(currentAbs, 'utf8'),
      rewrittenPath,
      repoRoot,
      cache,
    )
    currentByPath.set(rewrittenPath, text)
    return text
  }

  for (const entry of commits) {
    const raw = git(
      ['diff-tree', '-r', '-z', '-M', '--name-status', parentSpec(entry.commit), entry.commit],
      repoRoot,
    )
    if (raw.status !== 0) {
      throw new Error(`git diff-tree ${entry.commit} failed: ${raw.stderr.trim()}`)
    }
    for (const change of parseNameStatus(raw.stdout.toString('utf8'))) {
      const rewritten = rewriteDevPath(change.path)
      if (rewritten === null) continue
      const tipText = await readTip(change.path, rewritten)
      const currentText = await readCurrent(rewritten)
      if (currentText === tipText) {
        findings.push({
          kind: 'present',
          commit: entry.commit.slice(0, 12),
          subject: entry.subject,
          devPath: change.path,
          rewrittenPath: rewritten,
          hunk: '(file)',
        })
        continue
      }
      const added = change.status.startsWith('A')
      const deleted = change.status.startsWith('D')
      const oldPath = change.oldPath ?? change.path
      const oldBuf = loadSide(parentSpec(entry.commit), oldPath, !added, repoRoot)
      const newBuf = loadSide(entry.commit, change.path, !deleted, repoRoot)
      const base = {
        commit: entry.commit.slice(0, 12),
        subject: entry.subject,
        devPath: change.path,
        rewrittenPath: rewritten,
      }
      if ((oldBuf !== null && isBinary(oldBuf)) || (newBuf !== null && isBinary(newBuf))) {
        findings.push({ ...base, kind: 'review', hunk: 'binary' })
        continue
      }
      const oldText =
        oldBuf === null
          ? null
          : await normalizeText(oldBuf.toString('utf8'), rewritten, repoRoot, cache)
      const newText =
        newBuf === null
          ? null
          : await normalizeText(newBuf.toString('utf8'), rewritten, repoRoot, cache)
      for (const classified of classifyNormalizedTexts({
        oldText,
        newText,
        currentText,
        tipText,
        rewrittenPath: rewritten,
      })) {
        const kind =
          classified.kind === 'missing' && isAcceptedRewrite(entry.commit, change.path)
            ? 'review'
            : classified.kind
        findings.push({ ...base, kind, hunk: classified.hunk })
      }
    }
  }
  return findings
}

export function formatAuditReport(findings: AuditFinding[]): string {
  const present = findings.filter(finding => finding.kind === 'present').length
  const drops = findings.filter(finding => finding.kind === 'missing')
  const reviews = findings.filter(finding => finding.kind === 'review')
  const lines = [
    `dev-sync audit`,
    `probed: ${findings.length}  present: ${present}  confirmed drops: ${drops.length}  review: ${reviews.length}`,
    '',
  ]
  if (drops.length === 0) {
    lines.push('confirmed drops: none')
  } else {
    lines.push('confirmed drops:')
    for (const drop of drops) {
      lines.push(`  ${drop.commit}  ${drop.rewrittenPath}`)
      lines.push(`    from ${drop.devPath}`)
      lines.push(`    ${drop.subject}`)
      lines.push(`    ${drop.hunk}`)
    }
  }
  lines.push('')
  if (reviews.length === 0) {
    lines.push('review: none')
  } else {
    lines.push('review:')
    const grouped = new Map<string, AuditFinding[]>()
    for (const review of reviews) {
      const list = grouped.get(review.rewrittenPath) ?? []
      list.push(review)
      grouped.set(review.rewrittenPath, list)
    }
    for (const [filePath, group] of [...grouped.entries()].sort((a, b) =>
      a[0].localeCompare(b[0]),
    )) {
      const commits = new Set(group.map(finding => finding.commit))
      lines.push(`  ${filePath}  ${group.length} hunks across ${commits.size} commits`)
    }
  }
  lines.push('')
  return lines.join('\n')
}

type CliOptions = {
  since: string
  ref: string
}

function printUsage(): string {
  return `Usage:
  pnpm sync:audit [--since ${DEV_SYNC_SINCE}] [--ref origin/dev]
`
}

export function parseArgs(argv: string[]): CliOptions {
  let since = DEV_SYNC_SINCE
  let ref = 'origin/dev'
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') {
      throw new Error(printUsage().trim())
    }
    if (arg === '--since') {
      const value = argv[index + 1]
      if (value === undefined) throw new Error('--since requires a commit')
      since = value
      index += 1
      continue
    }
    if (arg === '--ref') {
      const value = argv[index + 1]
      if (value === undefined) throw new Error('--ref requires a ref')
      ref = value
      index += 1
      continue
    }
    throw new Error(`Unknown argument: ${arg ?? ''}`)
  }
  return { since, ref }
}

export async function runCli(argv: string[]): Promise<CliResult> {
  try {
    const options = parseArgs(argv)
    const findings = await auditDevSync({ repoRoot: REPO_ROOT, ...options })
    const drops = findings.filter(finding => finding.kind === 'missing').length
    return {
      exitCode: drops > 0 ? 1 : 0,
      stdout: formatAuditReport(findings),
      stderr: '',
    }
  } catch (error) {
    return parseErrorResult(error, printUsage())
  }
}

if (isDirectRun(import.meta.url, process.argv[1])) {
  void runScriptMain(runCli)
}
