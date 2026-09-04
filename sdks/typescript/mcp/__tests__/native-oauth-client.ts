import { createSolvaPay } from '@solvapay/server'
import type {
  McpOauthRequestClient,
  McpOauthRequestResult,
} from '../src/internal/mcp-oauth-request'
import type { McpResolveAuthClient } from '../src/internal/mcp-resolve-auth'

export function nativeOauthClient(
  apiBaseUrl: string,
): McpOauthRequestClient & McpResolveAuthClient {
  const { apiClient } = createSolvaPay({ apiKey: 'sk_test', apiBaseUrl })
  if (typeof apiClient.mcpOauthRequest !== 'function') {
    throw new Error('SolvaPay API client is missing mcpOauthRequest')
  }
  if (typeof apiClient.mcpResolveAuth !== 'function') {
    throw new Error('SolvaPay API client is missing mcpResolveAuth')
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
