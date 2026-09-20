/**
 * Locate the published `create-solvapay` package root from any compiled
 * chunk. tsup may emit files at `dist/cli.js` or `dist/chunk-*.js`, so
 * a source-relative `../` walk is not stable. Walk up until we find the
 * package.json named `create-solvapay`.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

function resolvePackageRoot(startFile: string): string {
  let dir = dirname(startFile)
  while (true) {
    try {
      const raw = readFileSync(join(dir, 'package.json'), 'utf8')
      const pkg = JSON.parse(raw) as { name?: string }
      if (pkg.name === 'create-solvapay') return dir
    } catch {
      // keep walking up
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error('Could not locate create-solvapay package root')
}

export const PACKAGE_ROOT = resolvePackageRoot(fileURLToPath(import.meta.url))
