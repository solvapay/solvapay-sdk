// Copies the SolvaPay MCP App widget into the Go package.
//
// Builds mcp-app/ (one self-contained mcp-app.html, from @solvapay/react's MCP
// views) and writes it to ../mcp_widget.html, which mcp_app.go embeds with
// go:embed and NewMCPServer serves as its ui:// resource. Python ships the same
// file in its wheel (python/scripts/sync_widget.py).
//
// Run from go/ after `pnpm install` at the repo root:
//   node scripts/sync_widget.mjs              build, then copy
//   node scripts/sync_widget.mjs --no-build   copy mcp-app/dist as it is
//   node scripts/sync_widget.mjs --check      fail when the committed copy is stale (CI)
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const goDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const built = join(goDir, '..', 'mcp-app', 'dist', 'mcp-app.html')
const out = join(goDir, 'mcp_widget.html')

if (!process.argv.includes('--no-build')) {
  execFileSync('pnpm', ['--filter', '@solvapay/mcp-app', 'build'], {
    cwd: join(goDir, '..'),
    stdio: 'inherit',
  })
}
if (!existsSync(built)) {
  throw new Error(`${built} does not exist: build mcp-app/ first`)
}
const html = readFileSync(built)
if (process.argv.includes('--check')) {
  if (!existsSync(out) || !readFileSync(out).equals(html)) {
    console.error('go/mcp_widget.html is out of date with mcp-app/. Run: node scripts/sync_widget.mjs')
    process.exit(1)
  }
  console.log('The widget is up to date')
} else {
  writeFileSync(out, html)
  console.log(`Wrote go/mcp_widget.html (${html.length} bytes)`)
}
