#!/usr/bin/env node
/**
 * Starts a cloudflared quick tunnel → localhost:<MCP_PORT>, waits for the
 * assigned trycloudflare.com URL, then launches the MCP server with
 * MCP_PUBLIC_BASE_URL pointing at the tunnel.
 *
 * Usage:
 *   node tunnel.mjs          # uses MCP_PORT from env or defaults to 3006
 *   pnpm tunnel              # same via package.json script
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PORT = process.env.MCP_PORT ?? '3006'
const TUNNEL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/

/**
 * Locate the tsx CLI, handling both standard pnpm .bin symlinks and the
 * .aube/.ignored_* virtual store convention used in this monorepo.
 */
function findTsxCli() {
  const roots = [__dirname, resolve(__dirname, '../..')]
  for (const root of roots) {
    const candidates = [
      join(root, 'node_modules', '.bin', 'tsx'),
      join(root, 'node_modules', '.ignored_tsx', 'dist', 'cli.mjs'),
    ]
    const found = candidates.find(existsSync)
    if (found) return found
  }
  return null
}

/** Spawn cloudflared and resolve with the public URL once it appears in output. */
function startTunnel(port) {
  return new Promise((resolve, reject) => {
    const cf = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${port}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const onData = (chunk) => {
      const text = chunk.toString()
      process.stderr.write(text)
      const match = text.match(TUNNEL_RE)
      if (match) {
        cf.stdout.off('data', onData)
        cf.stderr.off('data', onData)
        resolve({ url: match[0], proc: cf })
      }
    }

    cf.stdout.on('data', onData)
    cf.stderr.on('data', onData)
    cf.on('error', (err) => reject(new Error(`cloudflared error: ${err.message}`)))
    cf.on('exit', (code) => {
      if (code !== 0 && code !== null)
        reject(new Error(`cloudflared exited early with code ${code}`))
    })

    setTimeout(
      () => reject(new Error('Timed out after 30 s waiting for tunnel URL')),
      30_000,
    )
  })
}

const tsxCli = findTsxCli()
if (!tsxCli) {
  console.error('[tunnel] ERROR: could not find tsx in node_modules')
  process.exit(1)
}

// If tsx resolved to a .mjs file (e.g. .ignored_tsx/dist/cli.mjs) we must
// invoke it via `node`; otherwise it's an executable symlink we can spawn directly.
const [cmd, args] = tsxCli.endsWith('.mjs')
  ? [process.execPath, [tsxCli, 'src/index.ts']]
  : [tsxCli, ['src/index.ts']]

console.error(`[tunnel] starting cloudflared quick tunnel → http://localhost:${PORT}`)
const { url, proc: cfProc } = await startTunnel(PORT)

console.error(`\n[tunnel] public URL: ${url}`)
console.error(`[tunnel] MCP endpoint: ${url}/mcp\n`)

const server = spawn(cmd, args, {
  cwd: __dirname,
  env: { ...process.env, MCP_PUBLIC_BASE_URL: url },
  stdio: 'inherit',
})

const cleanup = () => {
  server.kill()
  cfProc.kill()
}

process.on('SIGINT', () => { cleanup(); process.exit(0) })
process.on('SIGTERM', () => { cleanup(); process.exit(0) })
server.on('exit', () => { cfProc.kill(); process.exit(0) })
cfProc.on('exit', () => { server.kill(); process.exit(0) })
