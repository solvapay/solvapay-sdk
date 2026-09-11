/**
 * Remove generated artifacts (and optionally regenerate + verify they come back).
 *
 *   pnpm gen:clean
 *   pnpm gen:verify   # clean → gen → git status over the same paths
 */

import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { REPO_ROOT } from '../shared/paths.js'
import { loadRepoPathsManifest } from '../shared/repo-paths.js'
import type { RepoPathsManifest } from '../shared/repo-paths-schema.js'
import { runGen } from './gen.js'
import { isDirectRun, parseErrorResult, runScriptMain, type CliResult } from './lib/cli.js'
import { hasMarker } from './lib/generated-marker.js'

export interface CleanTarget {
  id: string
  rel: string
}

export interface CleanPlan {
  files: CleanTarget[]
  directories: CleanTarget[]
}

export interface CleanFs {
  exists(rel: string): boolean
  readFile(rel: string): string
  isDirectory(rel: string): boolean
  listFiles(rel: string): string[]
  remove(rel: string): void
}

export interface CleanResult {
  removed: string[]
  alreadyAbsent: string[]
  handwritten: Array<{ dir: string; rel: string }>
  errors: string[]
}

export interface VerifyReport {
  missing: string[]
}

function isFilePath(rel: string): boolean {
  const base = rel.split('/').pop() ?? rel
  return base.includes('.')
}

export function planClean(manifest: RepoPathsManifest = loadRepoPathsManifest()): CleanPlan {
  const files: CleanTarget[] = []
  const directories: CleanTarget[] = []
  for (const entry of manifest.generated) {
    if (entry.driftPaths !== undefined) {
      for (const rel of entry.driftPaths) {
        files.push({ id: entry.id, rel })
      }
      continue
    }
    if (isFilePath(entry.path)) {
      files.push({ id: entry.id, rel: entry.path })
      continue
    }
    directories.push({ id: entry.id, rel: entry.path })
  }
  return { files, directories }
}

export function hasGeneratedMarker(contents: string): boolean {
  return hasMarker(contents)
}

export function realCleanFs(root: string): CleanFs {
  const abs = (rel: string): string => path.join(root, ...rel.split('/'))
  return {
    exists: rel => existsSync(abs(rel)),
    readFile: rel => readFileSync(abs(rel), 'utf8'),
    isDirectory: rel => existsSync(abs(rel)) && statSync(abs(rel)).isDirectory(),
    listFiles: rel => {
      const dir = abs(rel)
      if (!existsSync(dir) || !statSync(dir).isDirectory()) {
        return []
      }
      return readdirSync(dir)
        .filter(name => statSync(path.join(dir, name)).isFile())
        .map(name => `${rel}/${name}`)
    },
    remove: rel => {
      rmSync(abs(rel), { force: true })
    },
  }
}

function expandDirectory(dir: CleanTarget, fs: CleanFs): CleanTarget[] {
  return fs.listFiles(dir.rel).map(rel => ({ id: dir.id, rel }))
}

export function executeClean(plan: CleanPlan, fs: CleanFs): CleanResult {
  const targets: CleanTarget[] = [
    ...plan.files,
    ...plan.directories.flatMap(dir => expandDirectory(dir, fs)),
  ]
  const planned = new Set(targets.map(target => target.rel))
  const removed: string[] = []
  const alreadyAbsent: string[] = []
  const errors: string[] = []

  for (const target of targets) {
    if (!fs.exists(target.rel)) {
      alreadyAbsent.push(target.rel)
      continue
    }
    if (fs.isDirectory(target.rel)) {
      continue
    }
    const contents = fs.readFile(target.rel)
    if (!hasGeneratedMarker(contents)) {
      errors.push(target.rel)
      continue
    }
    fs.remove(target.rel)
    removed.push(target.rel)
  }

  const handwritten: Array<{ dir: string; rel: string }> = []
  const dirRels = new Set<string>()
  for (const file of plan.files) {
    const dir = file.rel.split('/').slice(0, -1).join('/')
    if (dir.length > 0) {
      dirRels.add(dir)
    }
  }
  for (const dir of plan.directories) {
    dirRels.add(dir.rel)
  }
  for (const dir of dirRels) {
    for (const rel of fs.listFiles(dir)) {
      if (planned.has(rel)) {
        continue
      }
      if (!fs.exists(rel)) {
        continue
      }
      const contents = fs.readFile(rel)
      if (!hasGeneratedMarker(contents)) {
        handwritten.push({ dir, rel })
      }
    }
  }

  return { removed, alreadyAbsent, handwritten, errors }
}

export function interpretVerifyStatus(porcelain: string, planned: readonly string[]): VerifyReport {
  const plannedSet = new Set(planned)
  const missing: string[] = []
  for (const line of porcelain.split('\n')) {
    if (line.trim() === '') {
      continue
    }
    const status = line.slice(0, 2)
    const rel = line.slice(3)
    if (!plannedSet.has(rel)) {
      continue
    }
    if (status.includes('D')) {
      missing.push(rel)
    }
  }
  return { missing }
}

function formatCleanReport(result: CleanResult, plan: CleanPlan): string {
  const idForRel = (rel: string): string => {
    const file = plan.files.find(item => item.rel === rel)
    if (file !== undefined) {
      return file.id
    }
    const dir = plan.directories.find(item => rel === item.rel || rel.startsWith(`${item.rel}/`))
    if (dir !== undefined) {
      return dir.id
    }
    return rel
  }
  const removedById = new Map<string, string[]>()
  for (const rel of result.removed) {
    const id = idForRel(rel)
    const list = removedById.get(id) ?? []
    list.push(rel)
    removedById.set(id, list)
  }
  const lines: string[] = ['Removed:']
  if (result.removed.length === 0) {
    lines.push('  (none)')
  } else {
    for (const [id, rels] of removedById) {
      lines.push(`  ${id}:`)
      for (const rel of rels) {
        lines.push(`    ${rel}`)
      }
    }
  }
  lines.push('Already absent:')
  if (result.alreadyAbsent.length === 0) {
    lines.push('  (none)')
  } else {
    for (const rel of result.alreadyAbsent) {
      lines.push(`  ${rel}`)
    }
  }
  lines.push('Hand-written files still present in generated directories:')
  if (result.handwritten.length === 0) {
    lines.push('  (none)')
  } else {
    for (const item of result.handwritten) {
      lines.push(`  ${item.rel}`)
    }
  }
  const external = loadRepoPathsManifest().externalGenerated
  lines.push('external generators (not covered by gen:clean):')
  for (const entry of external) {
    lines.push(`  ${entry.id}: ${entry.generator}`)
  }
  return `${lines.join('\n')}\n`
}

function plannedRels(plan: CleanPlan, fs: CleanFs): string[] {
  return [
    ...plan.files.map(file => file.rel),
    ...plan.directories.flatMap(dir => expandDirectory(dir, fs).map(file => file.rel)),
  ]
}

export interface CleanCliDeps {
  fs?: CleanFs
  gen?: () => { exitCode: number; stdout: string; stderr: string }
  gitStatus?: (paths: readonly string[]) => string
}

function gitStatusPorcelain(paths: readonly string[]): string {
  const result = spawnSync('git', ['status', '--porcelain', '--', ...paths], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  })
  if (result.error) {
    throw result.error
  }
  return result.stdout ?? ''
}

export function parseArgs(argv: string[]): { verify: boolean } {
  let verify = false
  for (const arg of argv) {
    if (arg === '--verify') {
      verify = true
      continue
    }
    if (arg === '--help' || arg === '-h') {
      throw new Error('Usage: pnpm gen:clean | pnpm gen:verify')
    }
    throw new Error(`Unknown argument: ${arg}`)
  }
  return { verify }
}

export function runCli(argv: string[], deps: CleanCliDeps = {}): CliResult {
  let options: { verify: boolean }
  try {
    options = parseArgs(argv)
  } catch (error) {
    return parseErrorResult(error, 'Usage: pnpm gen:clean | pnpm gen:verify\n')
  }

  const plan = planClean()
  const fs = deps.fs ?? realCleanFs(REPO_ROOT)
  const result = executeClean(plan, fs)
  const stdout = formatCleanReport(result, plan)
  if (result.errors.length > 0) {
    return {
      exitCode: 1,
      stdout,
      stderr: `refusing to delete files without a generated marker:\n${result.errors.map(rel => `  ${rel}`).join('\n')}\n`,
    }
  }

  if (!options.verify) {
    return { exitCode: 0, stdout, stderr: '' }
  }

  const gen = deps.gen ?? (() => runGen({ check: false }))
  const generated = gen()
  if (generated.exitCode !== 0) {
    return {
      exitCode: generated.exitCode,
      stdout: `${stdout}${generated.stdout}`,
      stderr: generated.stderr,
    }
  }

  const planned = plannedRels(plan, fs)
  const porcelain = (deps.gitStatus ?? gitStatusPorcelain)(planned)
  const report = interpretVerifyStatus(porcelain, planned)
  if (report.missing.length > 0) {
    return {
      exitCode: 1,
      stdout: `${stdout}${generated.stdout}`,
      stderr: `cleaned but not regenerated:\n${report.missing.map(rel => `  ${rel}`).join('\n')}\n`,
    }
  }
  return {
    exitCode: 0,
    stdout: `${stdout}${generated.stdout}gen:verify: all cleaned paths were regenerated\n`,
    stderr: '',
  }
}

if (isDirectRun(import.meta.url, process.argv[1])) {
  void runScriptMain(async argv => runCli(argv))
}
