/**
 * Copies the platform's committed SDK spec into this repo.
 *
 * `openapi/sdk-v1.json` is written by the platform (`npm run openapi:sdk` in
 * solvapay/platform) and is the source of truth for every API call an SDK
 * makes. This repo keeps a copy so its builds never depend on a running
 * backend: the TypeScript types and the Python client are generated from it.
 *
 * Usage:
 *   pnpm spec:sync <path to a solvapay/platform checkout>
 *
 * It records the platform commit it copied from in openapi/sdk-v1.source.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const platformDir = process.argv[2]
if (!platformDir) {
  console.error('Usage: pnpm spec:sync <path to a solvapay/platform checkout>')
  process.exit(1)
}

const source = resolve(platformDir, 'openapi', 'sdk-v1.json')
if (!existsSync(source)) {
  console.error(`${source} does not exist. Is ${platformDir} a solvapay/platform checkout?`)
  process.exit(1)
}

const git = (...args: string[]) =>
  execFileSync('git', ['-C', platformDir, ...args], { encoding: 'utf-8' }).trim()

const commit = git('rev-parse', 'HEAD')
const dirty = git('status', '--porcelain', '--', 'openapi/sdk-v1.json')
if (dirty) {
  console.error(
    `openapi/sdk-v1.json has uncommitted changes in ${platformDir}. Copy a committed spec only.`,
  )
  process.exit(1)
}

const spec = readFileSync(source, 'utf-8')
JSON.parse(spec) // fail on a broken file before writing anything

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
writeFileSync(join(repoRoot, 'openapi', 'sdk-v1.json'), spec)
writeFileSync(join(repoRoot, 'openapi', 'sdk-v1.source'), `solvapay/platform@${commit}\n`)
console.log(`Copied openapi/sdk-v1.json from solvapay/platform@${commit.slice(0, 9)}`)
