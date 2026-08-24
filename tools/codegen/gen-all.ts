/**
 * Full local codegen pipeline:
 *   1. Refresh OpenAPI snapshot when the local five-service stack is reachable
 *   2. Regenerate all surfaces (`pnpm gen`)
 *   3. Run `manifest:check` + `parity:check`
 *
 * Runbook: docs/contributing/sdk-codegen.md
 */

import { spawnSync } from 'node:child_process'
import { REPO_ROOT } from '../shared/paths.js'
import { loadLocalStack } from './snapshot-openapi.js'

const STACK_ORIGIN = 'http://localhost'

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

async function liveStackAvailable(): Promise<boolean> {
  for (const service of loadLocalStack()) {
    const url = `${STACK_ORIGIN}:${service.port}/v1/openapi.json`
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) })
      if (!response.ok) {
        return false
      }
    } catch {
      return false
    }
  }
  return true
}

async function main(): Promise<void> {
  if (await liveStackAvailable()) {
    console.log(`Live OpenAPI stack at ${STACK_ORIGIN} — refreshing snapshot via --from-stack…`)
    run('pnpm', ['snapshot:openapi', '--from-stack', STACK_ORIGIN])
  } else {
    console.log(`No live OpenAPI stack at ${STACK_ORIGIN} — using committed OpenAPI snapshot`)
  }

  run('pnpm', ['gen'])
  run('pnpm', ['manifest:check'])
  run('pnpm', ['parity:check'])
  console.log('gen:all complete')
}

void main()
