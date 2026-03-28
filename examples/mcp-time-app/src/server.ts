import fs from 'node:fs/promises'
import path from 'node:path'
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult, ReadResourceResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'

const DIST_DIR = import.meta.filename.endsWith('.ts')
  ? path.join(import.meta.dirname, '../dist')
  : import.meta.dirname

const resourceUri = 'ui://mcp-time-app/mcp-app.html'

export function createServer() {
  const server = new McpServer({
    name: 'solvapay-mcp-time-app',
    version: '1.0.0',
  })

  registerAppTool(
    server,
    'get-current-time',
    {
      title: 'Get current time',
      description: 'Returns the current server time in a readable local format.',
      inputSchema: {},
      outputSchema: z.object({
        currentTime: z.string(),
      }),
      _meta: {
        ui: {
          resourceUri,
        },
      },
    },
    async (): Promise<CallToolResult> => {
      const currentTime = new Date().toLocaleString()

      return {
        content: [{ type: 'text', text: currentTime }],
        structuredContent: { currentTime },
      }
    },
  )

  registerAppResource(
    server,
    resourceUri,
    resourceUri,
    { mimeType: RESOURCE_MIME_TYPE },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(path.join(DIST_DIR, 'mcp-app.html'), 'utf-8')

      return {
        contents: [
          {
            uri: resourceUri,
            mimeType: RESOURCE_MIME_TYPE,
            text: html,
          },
        ],
      }
    },
  )

  return server
}
