/* global process */
/**
 * Vitest global setup — ensures `scripts/mcp/node_modules/` exists
 * before any smoke test spawns `describe.mjs` or `scaffold.mjs`.
 *
 * The scripts depend on `@apidevtools/swagger-parser`, declared in
 * `scripts/mcp/package.json` and installed lazily on first use by the
 * `from-openapi` CLI path (see `src/types/mcp/from-openapi.ts`). CI
 * doesn't run that path, so without this hook the smoke test would
 * fail with `ERR_MODULE_NOT_FOUND` on a fresh clone.
 *
 * Idempotent: skips when `node_modules/` already exists. Cost on a
 * cold checkout is one `npm install` (~5s); after that, zero.
 */

import { spawn } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const scriptsDir = resolve(here, 'scripts/mcp')

export default async function setup() {
  try {
    await stat(join(scriptsDir, 'node_modules'))
    return
  } catch {
    // proceed to install
  }
  await new Promise((res, rej) => {
    const child = spawn('npm', ['install', '--no-audit', '--no-fund', '--silent'], {
      cwd: scriptsDir,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    })
    child.once('error', rej)
    child.once('close', code => (code === 0 ? res() : rej(new Error(`npm install exited ${code}`))))
  })
}
