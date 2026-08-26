#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DIST_REL, VENDOR_TARGETS } from './targets.mjs'

const BUILD_COMMAND = 'pnpm --filter @solvapay/mcp-app-widget build'

export function vendorWidget({ root }) {
  const source = join(root, DIST_REL)
  if (!existsSync(source)) {
    throw new Error(`Missing ${source}. Run ${BUILD_COMMAND} before vendoring.`)
  }

  for (const rel of VENDOR_TARGETS) {
    const dest = join(root, rel)
    mkdirSync(dirname(dest), { recursive: true })
    copyFileSync(source, dest)
  }

  return VENDOR_TARGETS
}

function isCli(url) {
  const entry = process.argv[1]
  return Boolean(entry) && fileURLToPath(url) === resolve(entry)
}

function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
  const targets = vendorWidget({ root })
  for (const rel of targets) console.log(`vendored ${rel}`)
}

if (isCli(import.meta.url)) {
  main()
}
