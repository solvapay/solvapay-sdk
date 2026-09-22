import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export function resolvePackageRoot(startFile: string): string {
  let dir = dirname(startFile)
  while (true) {
    const parent = dirname(dir)
    if (parent === dir) break
    try {
      const raw = readFileSync(join(dir, 'package.json'), 'utf8')
      const pkg = JSON.parse(raw) as { name?: string }
      if (pkg.name === 'create-solvapay') return dir
    } catch {
      // keep walking up
    }
    dir = parent
  }
  throw new Error('Could not locate create-solvapay package root')
}

export const PACKAGE_ROOT = resolvePackageRoot(fileURLToPath(import.meta.url))
