import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runMcpEngineRequest } from '../src/engine-dispatch'
import { callMcpSyncOp } from '../src/native-mcp'

vi.mock('../src/native-mcp', () => ({
  callMcpSyncOp: vi.fn(),
}))

describe('widget action → tool result', () => {
  beforeEach(() => {
    vi.mocked(callMcpSyncOp).mockReset()
  })

  it('reads the widget then resumes a checkout action into the conversation result', async () => {
    const mcpDispatch = vi
      .fn()
      .mockResolvedValueOnce({
        kind: 'rpc',
        status: 200,
        rpc: {
          jsonrpc: '2.0',
          id: 1,
          result: {
            contents: [{ uri: 'ui://widget.html', mimeType: 'text/html', text: '<html></html>' }],
          },
        },
      })
      .mockResolvedValueOnce({
        kind: 'invokeHandler',
        tool: 'complete_checkout',
        token: 'tok_widget',
        args: { action: 'topup', amount: 12 },
        customerRef: 'cus_1',
      })

    vi.mocked(callMcpSyncOp).mockImplementation((op, args) => {
      if (op !== 'mcpResume') {
        throw new Error(`unexpected sync op ${String(op)}`)
      }
      const envelope = args as { handlerEnvelope: unknown }
      return { rpc: { jsonrpc: '2.0', id: 2, result: envelope.handlerEnvelope } }
    })

    const payables = new Map([
      [
        'complete_checkout',
        {
          invoke: async (args: Record<string, unknown>) => ({
            structuredContent: { widgetAction: args.action, echo: args },
            content: [{ type: 'text', text: JSON.stringify(args) }],
          }),
        },
      ],
    ])

    const config = {
      productRef: 'prd_demo',
      publicBaseUrl: 'https://app.example.com',
      resourceUri: 'ui://widget.html',
      payableTools: ['complete_checkout'],
    }

    const widget = await runMcpEngineRequest({
      mcpDispatch,
      rpc: {
        jsonrpc: '2.0',
        id: 1,
        method: 'resources/read',
        params: { uri: 'ui://widget.html' },
      },
      config,
      payables,
    })
    expect(widget.status).toBe(200)
    expect((widget.body as { result?: { contents?: unknown[] } }).result?.contents).toHaveLength(1)

    const result = await runMcpEngineRequest({
      mcpDispatch,
      rpc: {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'complete_checkout', arguments: { action: 'topup', amount: 12 } },
      },
      config,
      payables,
    })

    expect(result.status).toBe(200)
    const body = result.body as { result?: { structuredContent?: { widgetAction?: string } } }
    expect(body.result?.structuredContent?.widgetAction).toBe('topup')
    expect(callMcpSyncOp).toHaveBeenCalledWith(
      'mcpResume',
      expect.objectContaining({ token: 'tok_widget' }),
    )
  })
})
