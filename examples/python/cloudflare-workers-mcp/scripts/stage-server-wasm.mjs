import { cp, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const exampleRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = join(exampleRoot, '../../..')
const wasmPkg = join(exampleRoot, '../../../sdks/wasm')
const dest = join(exampleRoot, 'src/vendor/server-wasm')
const widgetHtmlSrc = join(repoRoot, 'sdks/python-mcp/python/solvapay_mcp/data/mcp-app.html')

const files = [
  ['runtime/workerd.js', 'runtime/workerd.js'],
  ['pkg/edge/solvapay_wasm.js', 'pkg/edge/solvapay_wasm.js'],
  ['pkg/edge/solvapay_wasm_bg.wasm', 'pkg/edge/solvapay_wasm_bg.wasm'],
]

async function main() {
  for (const [from] of files) {
    const src = join(wasmPkg, from)
    try {
      await stat(src)
    } catch {
      throw new Error(
        `Missing ${src} — run pnpm --filter @solvapay/server-wasm run build:wasm first`,
      )
    }
  }
  try {
    await stat(widgetHtmlSrc)
  } catch {
    throw new Error(`Missing ${widgetHtmlSrc} — Python MCP widget HTML is required`)
  }
  await mkdir(join(dest, 'runtime'), { recursive: true })
  await mkdir(join(dest, 'pkg/edge'), { recursive: true })
  for (const [from, to] of files) {
    await cp(join(wasmPkg, from), join(dest, to))
  }
  const html = await readFile(widgetHtmlSrc, 'utf8')
  await writeFile(
    join(dest, 'runtime/mcp-app-html.js'),
    `export const mcpAppHtml = ${JSON.stringify(html)}\n`,
  )
}

await main()
