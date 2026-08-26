import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

function mcpPackageRoot(): string {
  const moduleUrl = import.meta.url
  if (moduleUrl === '') {
    throw new Error('defaultMcpAppHtml requires a resolvable module URL')
  }
  const require = createRequire(moduleUrl)
  return dirname(require.resolve('@solvapay/mcp/package.json'))
}

/** Absolute path of the published MCP App widget HTML. */
export function defaultMcpAppHtmlPath(): string {
  return join(mcpPackageRoot(), 'mcp-app.html')
}

export async function defaultMcpAppHtml(): Promise<string> {
  return readFile(defaultMcpAppHtmlPath(), 'utf8')
}
