// A merchant's MCP server or API as an OAuth 2.1 protected resource (RFC
// 9728): the document that tells a host where to sign the owner in, and the
// 401 challenge that sends it there. SolvaPay's agent issuer is the
// authorization server; the access token it issues is an ordinary agent token
// whose `aud` is this resource.

/** The one scope an agent token carries. */
export const AGENT_SCOPE = 'usage'

export interface ProtectedResource {
  /** Canonical MCP or API URL, with its path. Becomes `resource` and the expected `aud`. */
  resource: string
  /** SolvaPay's agent issuer, e.g. `https://api.solvapay.com/v1/agent`. */
  authorizationServer: string
  /** Shown to hosts in the metadata document. */
  documentation?: string
  /** Where the metadata is served. Default: `/.well-known/oauth-protected-resource` + the resource path. */
  metadataPath?: string
}

/**
 * The canonical form SolvaPay compares resources in: scheme and host
 * lowercased, default port dropped, no trailing slash. A fragment or
 * credentials make it unusable as a resource, so they throw.
 */
export function canonicalResource(resource: string): string {
  const url = new URL(resource)
  if (url.hash || url.username || url.password) {
    throw new Error(`${resource} cannot be an OAuth resource: no fragment or credentials`)
  }
  return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}${url.search}`
}

/** The RFC 9728 path-suffixed form, which hosts try first: `/.well-known/oauth-protected-resource/mcp`. */
export function protectedResourceMetadataPath(resource: ProtectedResource): string {
  if (resource.metadataPath) return resource.metadataPath
  const { pathname } = new URL(canonicalResource(resource.resource))
  return `/.well-known/oauth-protected-resource${pathname === '/' ? '' : pathname}`
}

/** The absolute URL a challenge points hosts at. */
export function protectedResourceMetadataUrl(resource: ProtectedResource): string {
  return new URL(protectedResourceMetadataPath(resource), resource.resource).toString()
}

/**
 * The RFC 9728 document. `resource` is the URL with its path, not the bare
 * origin, and `authorization_servers` names SolvaPay's issuer.
 */
export function protectedResourceMetadata(
  resource: ProtectedResource & { serverName?: string },
): Record<string, unknown> {
  return {
    resource: canonicalResource(resource.resource),
    authorization_servers: [resource.authorizationServer],
    scopes_supported: [AGENT_SCOPE],
    bearer_methods_supported: ['header'],
    ...(resource.serverName ? { resource_name: resource.serverName } : {}),
    ...(resource.documentation ? { resource_documentation: resource.documentation } : {}),
  }
}

function quoted(value: string): string {
  return value.replace(/[\\"]/g, ch => `\\${ch}`)
}

/**
 * The `WWW-Authenticate` challenge hosts look for, with `error` and
 * `error_description` both present (ChatGPT requires both) and the one scope,
 * so hosts ask for nothing broader.
 */
export function challengeHeaders(resource: ProtectedResource, description: string): Headers {
  return new Headers({
    'WWW-Authenticate':
      `Bearer error="invalid_token", error_description="${quoted(description)}", ` +
      `resource_metadata="${protectedResourceMetadataUrl(resource)}", scope="${AGENT_SCOPE}"`,
    'Access-Control-Expose-Headers': 'WWW-Authenticate',
  })
}

/** A 401 JSON-RPC error with the challenge: the host signs the owner in, or refreshes, and retries. */
export function authChallenge(options: {
  protectedResource: ProtectedResource
  description: string
  jsonRpcId?: unknown
}): Response {
  const headers = challengeHeaders(options.protectedResource, options.description)
  headers.set('Content-Type', 'application/json')
  return new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      id: options.jsonRpcId ?? null,
      error: { code: -32001, message: options.description },
    }),
    { status: 401, headers },
  )
}

/**
 * Serves the metadata document at its path (GET, public, cacheable, any
 * origin), for an API or a server that is not on `createAgentMcpRoute`.
 * Anything else is `null`, for the merchant's own handler.
 */
export function protectedResourceHandler(
  resource: ProtectedResource & { serverName?: string },
  extraPaths: string[] = [],
): (request: Request) => Response | null {
  const paths = new Set([protectedResourceMetadataPath(resource), ...extraPaths])
  return request => {
    if (request.method !== 'GET' && request.method !== 'HEAD') return null
    if (!paths.has(new URL(request.url).pathname)) return null
    return Response.json(protectedResourceMetadata(resource), {
      headers: {
        'Cache-Control': 'public, max-age=300',
        'Access-Control-Allow-Origin': '*',
      },
    })
  }
}
