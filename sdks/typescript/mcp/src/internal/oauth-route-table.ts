/**
 * Shared OAuth path table used by the Express and Fetch adapters.
 * Route bodies still go through `mcpOauthRequest`; this module only
 * names paths, methods, and which dispatch path the native op expects.
 */

import {
  pathAwareProtectedResourcePath,
  resolveOAuthPaths,
  type OAuthBridgePaths,
} from '@solvapay/mcp-core'
import type { McpOauthRequestConfig } from './mcp-oauth-request'

export const OPENID_PATH = '/.well-known/openid-configuration'
export const DEFAULT_PROTECTED_RESOURCE_PATH = '/.well-known/oauth-protected-resource'
export const DEFAULT_AUTHORIZATION_SERVER_PATH = '/.well-known/oauth-authorization-server'

export type OauthProxyRoute = {
  methods: readonly string[]
  corsPreflight: boolean
  defaultFormContentType: boolean
  match: (pathname: string) => boolean
  dispatchPath: (pathname: string, search: string) => string
}

export function oauthConfig(options: {
  apiBaseUrl: string
  productRef?: string
  publicBaseUrl?: string
  mcpPath?: string
  oauthPaths?: OAuthBridgePaths
}): McpOauthRequestConfig {
  return {
    publicBaseUrl: options.publicBaseUrl ?? '',
    productRef: options.productRef ?? '',
    apiBaseUrl: options.apiBaseUrl,
    ...(options.mcpPath !== undefined ? { mcpPath: options.mcpPath } : {}),
    ...(options.oauthPaths !== undefined ? { oauthPaths: options.oauthPaths } : {}),
  }
}

export function matchesProtectedResource(
  pathname: string,
  protectedResourcePath: string,
  metadataPath: string,
): boolean {
  return (
    pathname === protectedResourcePath ||
    pathname === metadataPath ||
    pathname.startsWith(`${DEFAULT_PROTECTED_RESOURCE_PATH}/`)
  )
}

export function oauthProxyRoutes(options: {
  mcpPath?: string
  protectedResourcePath?: string
  authorizationServerPath?: string
  oauthPaths?: OAuthBridgePaths
}): OauthProxyRoute[] {
  const paths = resolveOAuthPaths(options.oauthPaths)
  const protectedResourcePath =
    options.protectedResourcePath ?? DEFAULT_PROTECTED_RESOURCE_PATH
  const authorizationServerPath =
    options.authorizationServerPath ?? DEFAULT_AUTHORIZATION_SERVER_PATH
  const metadataPath = options.mcpPath
    ? pathAwareProtectedResourcePath(options.mcpPath)
    : protectedResourcePath

  return [
    {
      methods: ['GET'],
      corsPreflight: false,
      defaultFormContentType: false,
      match: pathname => pathname === OPENID_PATH,
      dispatchPath: () => OPENID_PATH,
    },
    {
      methods: ['GET'],
      corsPreflight: false,
      defaultFormContentType: false,
      match: pathname =>
        matchesProtectedResource(pathname, protectedResourcePath, metadataPath),
      dispatchPath: pathname => pathname,
    },
    {
      methods: ['GET'],
      corsPreflight: false,
      defaultFormContentType: false,
      match: pathname => pathname === authorizationServerPath,
      dispatchPath: () => DEFAULT_AUTHORIZATION_SERVER_PATH,
    },
    {
      methods: ['POST'],
      corsPreflight: true,
      defaultFormContentType: false,
      match: pathname => pathname === paths.register,
      dispatchPath: () => '/oauth/register',
    },
    {
      methods: ['GET'],
      corsPreflight: true,
      defaultFormContentType: false,
      match: pathname => pathname === paths.authorize,
      dispatchPath: (_pathname, search) => `/oauth/authorize${search}`,
    },
    {
      methods: ['POST'],
      corsPreflight: true,
      defaultFormContentType: true,
      match: pathname => pathname === paths.token,
      dispatchPath: () => '/oauth/token',
    },
    {
      methods: ['POST'],
      corsPreflight: true,
      defaultFormContentType: true,
      match: pathname => pathname === paths.revoke,
      dispatchPath: () => '/oauth/revoke',
    },
  ]
}
