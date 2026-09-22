/**
 * Emit the reviewed browser-safe wasm allowlist from wasm-profiles.yaml.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import { REPO_ROOT } from '../shared/paths.js'
import { generatedEntry, loadRepoPathsManifest } from '../shared/repo-paths.js'
import { isDirectRun, parseErrorResult, runScriptMain, type CliResult } from './lib/cli.js'

function wasmProfilesRel(): string {
  const rel = loadRepoPathsManifest().lookups.wasmProfiles
  if (rel === undefined) {
    throw new Error('unknown repo-paths lookup: wasmProfiles')
  }
  return rel
}

export type WasmProfilesFile = {
  browserSafe: string[]
  excluded?: Array<{ name: string; reason: string }>
}

export type BrowserSymbolsFile = {
  _comment: string
  browserSafe: string[]
}

function absRel(rel: string): string {
  return path.join(REPO_ROOT, ...rel.split('/'))
}

export function loadWasmProfiles(): WasmProfilesFile {
  const profilesRel = wasmProfilesRel()
  const raw: unknown = parseYaml(readFileSync(absRel(profilesRel), 'utf8'))
  if (typeof raw !== 'object' || raw === null || !('browserSafe' in raw)) {
    throw new Error(`${profilesRel}: missing browserSafe`)
  }
  const profiles = raw as WasmProfilesFile
  if (!Array.isArray(profiles.browserSafe) || profiles.browserSafe.length === 0) {
    throw new Error(`${profilesRel}: browserSafe must be a non-empty list`)
  }
  return profiles
}

export function buildBrowserSymbols(profiles: WasmProfilesFile): BrowserSymbolsFile {
  return {
    _comment: `@generated from ${wasmProfilesRel()} — do not edit. Regenerated: pnpm gen`,
    browserSafe: [...profiles.browserSafe],
  }
}

export function writeWasmBrowserSymbols(): { text: string; outRel: string } {
  const outRel = generatedEntry('wasmBrowserSymbols').path
  const file = buildBrowserSymbols(loadWasmProfiles())
  const text = `${JSON.stringify(file, null, 2)}\n`
  writeFileSync(absRel(outRel), text)
  return { text, outRel }
}

export function runWasmProfiles(): CliResult {
  const { outRel } = writeWasmBrowserSymbols()
  return {
    exitCode: 0,
    stdout: `wasm-profiles: wrote ${outRel}\n`,
    stderr: '',
  }
}

export async function runCli(argv: string[]): Promise<CliResult> {
  try {
    if (argv.includes('--help') || argv.includes('-h')) {
      throw new Error('Usage: write wasm browser-symbols.generated.json')
    }
    return runWasmProfiles()
  } catch (error) {
    return parseErrorResult(error, 'Usage: write wasm browser-symbols.generated.json\n')
  }
}

if (isDirectRun(import.meta.url, process.argv[1])) {
  void runScriptMain(runCli)
}
