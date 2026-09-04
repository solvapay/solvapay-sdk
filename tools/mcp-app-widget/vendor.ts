#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { joinRel, REPO_ROOT } from '../shared/paths.js'
import { mcpAppWidgetLayout } from '../shared/repo-paths.js'

const BUILD_COMMAND = 'pnpm --filter @solvapay/mcp-app-widget build'

export function vendorWidget({ root }: { root: string }): string[] {
  const layout = mcpAppWidgetLayout()
  const source = joinRel(root, layout.distRel)
  if (!existsSync(source)) {
    throw new Error(`Missing ${source}. Run ${BUILD_COMMAND} before vendoring.`)
  }

  const targets = [layout.canonicalRel, ...layout.copiesRel]
  for (const rel of targets) {
    const dest = joinRel(root, rel)
    mkdirSync(dirname(dest), { recursive: true })
    copyFileSync(source, dest)
  }

  return targets
}

function main(): void {
  const targets = vendorWidget({ root: REPO_ROOT })
  for (const rel of targets) console.log(`vendored ${rel}`)
}

const entry = process.argv[1]
if (entry !== undefined && fileURLToPath(import.meta.url) === resolve(entry)) {
  main()
}
