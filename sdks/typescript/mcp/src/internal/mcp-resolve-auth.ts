/**
 * Host-side `mcpResolveAuth`: one JSON contract for MCP bearer decisions.
 */

export type McpResolveAuthParams = {
  rpcMethod?: string
  authHeader?: string | null
  authMode?: string
  publicBaseUrl: string
  mcpPath?: string
  jsonRpcId?: string | number | null
  hs256Secret?: string
  jwksJson?: unknown
}

export type McpResolveAuthClient = {
  mcpResolveAuth: (params: McpResolveAuthParams) => Promise<unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

export async function mcpResolveAuth(
  params: McpResolveAuthParams,
  client: McpResolveAuthClient,
): Promise<Record<string, unknown>> {
  const envelope = await client.mcpResolveAuth(params)
  if (!isRecord(envelope)) {
    throw new Error('mcpResolveAuth returned a non-object envelope')
  }
  const kind = envelope.kind
  if (kind !== 'allow' && kind !== 'challenge' && kind !== 'error') {
    throw new Error(`mcpResolveAuth returned unexpected kind: ${String(kind)}`)
  }
  return envelope
}

export function requireResolveAuthClient(
  client: McpResolveAuthClient | null | undefined,
): McpResolveAuthClient {
  if (client == null) {
    throw new Error(
      'oauthClient is required; pass the SolvaPay API client that implements mcpResolveAuth',
    )
  }
  return client
}
