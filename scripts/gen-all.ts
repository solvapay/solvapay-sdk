/**
 * Full local codegen pipeline:
 *   1. Refresh OpenAPI snapshot when a live backend is reachable
 *   2. Regenerate all surfaces (`pnpm gen`)
 *   3. Run `manifest:check` + `parity:check`
 *
 * Runbook: docs/contributing/sdk-codegen.md
 */

import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_URL = 'http://localhost:3001/v1/openapi.json'

function run(command: string, args: string[], opts?: { allowFail?: boolean }): number {
  const result = spawnSync(command, args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: 'inherit',
  })
  const code = result.status ?? 1
  if (code !== 0 && !opts?.allowFail) {
    process.exit(code)
  }
  return code
}

async function liveBackendAvailable(): Promise<boolean> {
  try {
    const response = await fetch(DEFAULT_URL, {
      signal: AbortSignal.timeout(2000),
    })
    return response.ok
  } catch {
    return false
  }
}

async function main(): Promise<void> {
  if (await liveBackendAvailable()) {
    console.log(`Live OpenAPI at ${DEFAULT_URL} — refreshing snapshot…`)
    run('pnpm', ['snapshot:openapi', '--from-url', DEFAULT_URL])
  } else {
    console.log(`No live backend at ${DEFAULT_URL} — using committed OpenAPI snapshot`)
  }

  run('pnpm', ['gen'])
  run('pnpm', ['manifest:check'])
  run('pnpm', ['parity:check'])
  console.log('gen:all complete')
}

void main()
