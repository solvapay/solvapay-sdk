/**
 * Re-export the Rust-backed OAuth error normaliser from `@solvapay/mcp-core`.
 * Adapter bridges keep importing this path so existing tests stay put.
 */

export {
  buildErrorDescription,
  deriveOAuthErrorCode,
  hasOAuthErrorShape,
  toOAuthErrorBody,
  VALID_OAUTH_TOKEN_ERROR_CODES,
} from '@solvapay/mcp-core'
export type { OAuthErrorBody, OAuthTokenErrorCode } from '@solvapay/mcp-core'
