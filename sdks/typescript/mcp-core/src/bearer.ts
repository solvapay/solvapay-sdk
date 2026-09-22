/**
 * MCP OAuth bearer helpers. Claim trust goes through Rust `mcpVerifyBearer`.
 * Structural parse / prefix / expectations live in core.
 */

import {
  customerRefFromClaims,
  decodeJwtPayloadUnverified,
  defaultMcpBearerExpectations as defaultMcpBearerExpectationsCore,
  extractBearerToken as extractBearerTokenCore,
} from '@solvapay/core'
import { callMcpSyncOp } from './native-mcp'

export class McpBearerAuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'McpBearerAuthError'
  }
}

export type McpBearerCustomerRefOptions = {
  claimPriority?: string[]
}

export type McpVerifyBearerOptions = McpBearerCustomerRefOptions & {
  jwksJson?: unknown
  hs256Secret?: string
  expectedIssuer: string
  expectedAudience: string
  nowUnixSecs: number
}

export type McpVerifyBearerOk = {
  kind: 'ok'
  claims: Record<string, unknown>
  customerRef: string
}

export type McpVerifyBearerUnauthorized = {
  kind: 'unauthorized'
  status: number
  message: string
}

export type McpVerifyBearerResult = McpVerifyBearerOk | McpVerifyBearerUnauthorized

/** Issuer/audience defaults matching Rust `mcp_auth_gate`. */
export function defaultMcpBearerExpectations(
  publicBaseUrl: string,
  mcpPath?: string | null,
  nowUnixSecs: number = Math.floor(Date.now() / 1000),
): Pick<McpVerifyBearerOptions, 'expectedIssuer' | 'expectedAudience' | 'nowUnixSecs'> {
  return defaultMcpBearerExpectationsCore(publicBaseUrl, mcpPath ?? null, nowUnixSecs)
}

export function extractBearerToken(authorization?: string | null): string | null {
  return extractBearerTokenCore(authorization ?? null)
}

/** Structural payload parse. Not an authorization check. */
export function decodeJwtPayload(token: string): Record<string, unknown> {
  const payload = decodeJwtPayloadUnverified(token)
  if (payload === null || payload === undefined || typeof payload !== 'object') {
    throw new McpBearerAuthError(
      token.split('.').length < 2 ? 'Invalid JWT format' : 'Invalid JWT payload',
    )
  }
  return payload as Record<string, unknown>
}

export function getCustomerRefFromJwtPayload(
  payload: Record<string, unknown>,
  options: McpBearerCustomerRefOptions = {},
): string {
  const claimPriority = options.claimPriority || ['customerRef', 'customer_ref', 'sub']
  const ref = customerRefFromClaims(payload, options.claimPriority ?? null)
  if (typeof ref === 'string' && ref.trim()) {
    return ref.trim()
  }
  throw new McpBearerAuthError(
    `No customer reference claim found (checked: ${claimPriority.join(', ')})`,
  )
}

export function verifyBearer(
  token: string,
  options: McpVerifyBearerOptions,
): McpVerifyBearerResult {
  return callMcpSyncOp('mcpVerifyBearer', {
    token,
    expectedIssuer: options.expectedIssuer,
    expectedAudience: options.expectedAudience,
    nowUnixSecs: options.nowUnixSecs,
    ...(options.jwksJson !== undefined ? { jwksJson: options.jwksJson } : {}),
    ...(options.hs256Secret !== undefined ? { hs256Secret: options.hs256Secret } : {}),
    ...(options.claimPriority !== undefined ? { claimPriority: options.claimPriority } : {}),
  })
}

export function getCustomerRefFromBearerAuthHeader(
  authorization: string | null | undefined,
  options: McpVerifyBearerOptions,
): string {
  const token = extractBearerToken(authorization)
  if (!token) {
    throw new McpBearerAuthError('Missing bearer token')
  }
  const result = verifyBearer(token, options)
  if (result.kind !== 'ok') {
    throw new McpBearerAuthError(result.message)
  }
  return result.customerRef
}
