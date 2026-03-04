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
  private serverUrl: string
  private token: string
  private sessionId: string | null = null
  private nextId = 1

  constructor(serverUrl: string, token: string) {
    this.serverUrl = serverUrl.replace(/\/$/, '')
    this.token = token
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${this.token}`,
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
    const response = await fetch(`${this.serverUrl}/mcp`, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
    })
    const latencyMs = performance.now() - start

    if (!response.ok && response.status !== 200) {
      const text = await response.text().catch(() => '')
      throw new Error(`HTTP ${response.status}: ${text}`)
    }

    const json = (await response.json()) as JsonRpcResponse

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
      await fetch(`${this.serverUrl}/mcp`, {
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
