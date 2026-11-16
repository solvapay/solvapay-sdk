import { getOAuthProtectedResourceResponse, withoutTrailingSlash } from '@solvapay/mcp-core'

type ProtectedResourceDocument = ReturnType<typeof getOAuthProtectedResourceResponse>

/**
 * The protected-resource documents (RFC 9728) this server answers, by path:
 *
 * - the root well-known path, whose resource is the public base URL, as every
 *   `WWW-Authenticate` challenge points at it;
 * - that path with the MCP endpoint's path appended
 *   (`/.well-known/oauth-protected-resource/mcp`), which clients that start
 *   from the endpoint URL ask for first. RFC 9728 §3.3 has them discard a
 *   document whose resource isn't the URL they started from, so this one
 *   names the endpoint (`https://host/mcp`).
 *
 * Both keep this server as the authorization server; only `resource` differs.
 */
export function protectedResourceDocuments(
  publicBaseUrl: string,
  protectedResourcePath = '/.well-known/oauth-protected-resource',
  mcpPath?: string,
): Map<string, ProtectedResourceDocument> {
  const root = getOAuthProtectedResourceResponse(publicBaseUrl)
  const documents = new Map([[protectedResourcePath, root]])
  const trimmed = mcpPath?.replace(/\/+$/, '')
  if (trimmed) {
    const suffix = trimmed.startsWith('/') ? trimmed : `/${trimmed}`
    documents.set(`${protectedResourcePath}${suffix}`, {
      ...root,
      resource: `${withoutTrailingSlash(publicBaseUrl)}${suffix}`,
    })
  }
  return documents
}
