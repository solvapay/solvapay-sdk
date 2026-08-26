import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { defaultMcpAppHtml, RESOURCE_MIME_TYPE } from '../src'

const canonical = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../../../tools/mcp-app-widget/mcp-app.html'),
  'utf8',
)

describe('default MCP App widget', () => {
  it('returns HTML with a root mount', async () => {
    const html = await defaultMcpAppHtml()
    expect(html).toContain('id="root"')
  })

  it('mounts the bundled app', async () => {
    const html = await defaultMcpAppHtml()
    expect(html).toContain('<script')
    expect(html).toContain('solvapay://bootstrap.json')
  })

  it('uses the mcp-app mime profile', () => {
    expect(RESOURCE_MIME_TYPE).toBe('text/html;profile=mcp-app')
  })

  it('matches the canonical vendored artifact', async () => {
    expect(await defaultMcpAppHtml()).toBe(canonical)
  })
})
