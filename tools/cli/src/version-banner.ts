/**
 * Print the running CLI version on its own line. Dim ANSI escapes
 * (no chalk dep here) so the banner sits visually below the rest of
 * the output. Lets users — and skill agents calling `npx -y
 * solvapay@latest init` — confirm at a glance that `@latest` actually
 * re-resolved to the freshest publish rather than reusing a stale
 * npx cache entry.
 */
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const pkg = require('../package.json') as { version: string }

export const PACKAGE_VERSION = pkg.version

export const printVersionBanner = (): void => {
  const isTTY = process.stdout.isTTY
  const dim = isTTY ? '\x1b[2m' : ''
  const reset = isTTY ? '\x1b[22m' : ''
  process.stdout.write(`${dim}solvapay v${PACKAGE_VERSION}${reset}\n`)
}
