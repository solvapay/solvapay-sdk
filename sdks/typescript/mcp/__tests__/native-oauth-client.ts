import { createSolvaPay } from '@solvapay/server'
import type {
  McpOauthRequestClient,
  McpOauthRequestResult,
} from '../src/internal/mcp-oauth-request'

export function nativeOauthClient(apiBaseUrl: string): McpOauthRequestClient {
  const { apiClient } = createSolvaPay({ apiKey: 'sk_test', apiBaseUrl })
  if (typeof apiClient.mcpOauthRequest !== 'function') {
    throw new Error('SolvaPay API client is missing mcpOauthRequest')
  }
  return apiClient as McpOauthRequestClient
}

export function recordingOauthClient(
  respond:
    | McpOauthRequestResult
    | ((params: unknown) => McpOauthRequestResult | Promise<McpOauthRequestResult>),
): McpOauthRequestClient & { calls: unknown[] } {
  const calls: unknown[] = []
  return {
    calls,
    async mcpOauthRequest(params) {
      calls.push(params)
      return typeof respond === 'function' ? await respond(params) : respond
    },
  }
}

export function replyOauth(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): ReturnType<typeof recordingOauthClient> {
  return recordingOauthClient({
    status,
    headers: { 'content-type': 'application/json', ...headers },
    body,
  })
}

