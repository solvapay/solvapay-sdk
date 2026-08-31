import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { lookupPath } from '../../../../tools/shared/repo-paths.js'
import { RESOURCE_MIME_TYPE } from '../src'
import { defaultMcpAppHtml, defaultMcpAppHtmlPath } from '../src/defaultMcpAppHtml'

describe('default MCP App widget', () => {
  it('resolves HTML from the @solvapay/mcp package root', () => {
    expect(defaultMcpAppHtmlPath()).toBe(lookupPath('mcpAppWidgetTypescript'))
  })

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
    const canonical = readFileSync(lookupPath('mcpAppWidgetCanonical'), 'utf8')
    expect(await defaultMcpAppHtml()).toBe(canonical)
  })
})

describe('edge default MCP App widget', () => {
  it('throws and names readHtml or htmlPath', async () => {
    const { defaultMcpAppHtml: edgeHtml, defaultMcpAppHtmlPath } =
      await import('../src/defaultMcpAppHtml.edge')
    expect(() => defaultMcpAppHtmlPath()).toThrow(/readHtml|htmlPath/)
    await expect(edgeHtml()).rejects.toThrow(/readHtml|htmlPath/)
  })
})
