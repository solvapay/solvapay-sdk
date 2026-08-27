/**
 * Host-side `mcpOauthRequest`: one JSON contract for discovery + OAuth
 * proxy routes. Always dispatched through the native client.
 */

import type { OAuthBridgePaths } from '@solvapay/mcp-core'

export type McpOauthRequestConfig = {
  publicBaseUrl: string
  productRef: string
  apiBaseUrl: string
  mcpPath?: string
  oauthPaths?: OAuthBridgePaths
}

export type McpOauthRequestParams = {
  method: string
  path: string
  headers: Record<string, string>
  body: string
  config: McpOauthRequestConfig
}

export type McpOauthRequestResult = {
  status: number
  headers: Record<string, string>
  body: unknown
}

export type McpOauthRequestClient = {
  mcpOauthRequest: (params: {
    method: string
    path: string
    headers: Record<string, string>
    body: string
    config: {
      publicBaseUrl: string
      productRef: string
      mcpPath?: string
      oauthPaths?: OAuthBridgePaths
    }
  }) => Promise<unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

function asOauthResult(value: unknown): McpOauthRequestResult {
  if (!isRecord(value) || typeof value.status !== 'number') {
    throw new Error('mcpOauthRequest returned a result without status')
  }
  const headers: Record<string, string> = {}
  if (isRecord(value.headers)) {
    for (const [key, header] of Object.entries(value.headers)) {
      if (typeof header === 'string') headers[key] = header
    }
  }
  return { status: value.status, headers, body: value.body }
}

export async function mcpOauthRequest(
  params: McpOauthRequestParams,
  client: McpOauthRequestClient,
): Promise<McpOauthRequestResult> {
  const { apiBaseUrl, ...config } = params.config
  void apiBaseUrl
  return asOauthResult(
    await client.mcpOauthRequest({
      method: params.method,
      path: params.path,
      headers: params.headers,
      body: params.body,
      config,
    }),
  )
}

export function requireOauthClient(
  client: McpOauthRequestClient | null | undefined,
): McpOauthRequestClient {
  if (client == null) {
    throw new Error(
      'oauthClient is required; pass the SolvaPay API client that implements mcpOauthRequest',
    )
  }
  return client
}
