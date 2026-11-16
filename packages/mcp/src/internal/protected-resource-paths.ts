/**
 * The paths that serve the protected-resource document (RFC 9728): the root
 * well-known path, and that path with the MCP endpoint's path appended
 * (`/.well-known/oauth-protected-resource/mcp`), which clients that start from
 * the endpoint URL ask for first. Both answer the same document, so a client
 * names the same `resource` whichever it found, and tokens are bound alike.
 */
export function protectedResourcePaths(
  protectedResourcePath = '/.well-known/oauth-protected-resource',
  mcpPath?: string,
): string[] {
  const suffix = mcpPath?.replace(/\/+$/, '')
  if (!suffix || suffix === '') return [protectedResourcePath]
  const normalised = suffix.startsWith('/') ? suffix : `/${suffix}`
  return [protectedResourcePath, `${protectedResourcePath}${normalised}`]
}
