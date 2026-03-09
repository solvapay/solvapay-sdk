import { performance } from 'node:perf_hooks'

type JsonRpcId = string | number

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: JsonRpcId
  method: string
  params?: Record<string, unknown>
}

interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: JsonRpcId
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

export interface ToolCallResult {
  result: JsonRpcResponse
  latencyMs: number
  proxyHeaders?: {
    subrequestMs?: number
    upstreamResponseTime?: number
  }
}

export class McpClient {
  private mcpUrl: string
  private token: string | null
  private sessionId: string | null = null
  private nextId = 1

  constructor(mcpUrl: string, token?: string | null) {
    this.mcpUrl = mcpUrl.replace(/\/$/, '')
    this.token = token ?? null
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    }
    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`
    }
    if (this.sessionId) {
      headers['Mcp-Session-Id'] = this.sessionId
    }
    return headers
  }

  private async sendRequest(body: JsonRpcRequest): Promise<{
    json: JsonRpcResponse
    latencyMs: number
    headers: Headers
  }> {
    const start = performance.now()
    const response = await fetch(this.mcpUrl, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
    })
    const latencyMs = performance.now() - start

    const responseText = await response.text()

    if (!response.ok && response.status !== 200) {
      throw new Error(`HTTP ${response.status}: ${responseText}`)
    }

    if (!responseText) {
      return { json: { jsonrpc: '2.0' as const, id: body.id ?? 0 }, latencyMs, headers: response.headers }
    }

    const contentType = response.headers.get('content-type') ?? ''
    let json: JsonRpcResponse

    if (contentType.includes('text/event-stream')) {
      const dataLines = responseText
        .split('\n')
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice('data:'.length).trim())
        .filter(Boolean)
      if (dataLines.length === 0) throw new Error('SSE response contained no data line')
      json = JSON.parse(dataLines[dataLines.length - 1]) as JsonRpcResponse
    } else {
      json = JSON.parse(responseText) as JsonRpcResponse
    }

    const newSessionId = response.headers.get('mcp-session-id')
    if (newSessionId) {
      this.sessionId = newSessionId
    }

    return { json, latencyMs, headers: response.headers }
  }

  private extractProxyHeaders(headers: Headers) {
    const subrequestMs = headers.get('x-subrequest-ms')
    const upstreamResponseTime = headers.get('x-upstream-response-time')

    if (!subrequestMs && !upstreamResponseTime) return undefined

    return {
      subrequestMs: subrequestMs ? parseFloat(subrequestMs) : undefined,
      upstreamResponseTime: upstreamResponseTime
        ? parseFloat(upstreamResponseTime) * 1000
        : undefined,
    }
  }

  async initSession(): Promise<{ latencyMs: number }> {
    const { json, latencyMs } = await this.sendRequest({
      jsonrpc: '2.0',
      id: this.nextId++,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'solvapay-benchmark', version: '1.0.0' },
      },
    })

    if (json.error) {
      throw new Error(`Initialize failed: ${json.error.message}`)
    }

    await this.sendRequest({
      jsonrpc: '2.0',
      id: this.nextId++,
      method: 'notifications/initialized',
    })

    return { latencyMs }
  }

  async callTool(name: string, args: Record<string, unknown> = {}): Promise<ToolCallResult> {
    const { json, latencyMs, headers } = await this.sendRequest({
      jsonrpc: '2.0',
      id: this.nextId++,
      method: 'tools/call',
      params: { name, arguments: args },
    })

    return {
      result: json,
      latencyMs,
      proxyHeaders: this.extractProxyHeaders(headers),
    }
  }

  async listTools(): Promise<{ tools: unknown[]; latencyMs: number }> {
    const { json, latencyMs } = await this.sendRequest({
      jsonrpc: '2.0',
      id: this.nextId++,
      method: 'tools/list',
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tools = ((json.result as any)?.tools as unknown[]) ?? []
    return { tools, latencyMs }
  }

  async closeSession(): Promise<void> {
    if (!this.sessionId) return
    try {
      await fetch(this.mcpUrl, {
        method: 'DELETE',
        headers: this.buildHeaders(),
      })
    } catch {
      // Best-effort cleanup
    }
  }

  getSessionId(): string | null {
    return this.sessionId
  }
}
