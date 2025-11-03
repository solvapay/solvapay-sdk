/**
 * OAuth Storage
 * 
 * In-memory storage for OAuth authorization codes, refresh tokens, and revoked tokens.
 * In production, these should be stored in Redis or a database with TTL.
 * 
 * Note: User authentication is now handled by Supabase, so we no longer store users here.
 */

// Authorization codes storage (in production, use Redis or database)
export const authorizationCodes = new Map<string, { 
  userId: string; 
  clientId: string; 
  redirectUri: string; 
  scopes: string[]; 
  expiresAt: Date;
  email: string;
}>();

// Revoked tokens storage (in production, use Redis or database with TTL)
export const revokedTokens = new Set<string>();

// Refresh tokens storage (in production, use Redis or database)
export const refreshTokens = new Map<string, {
  userId: string;
  clientId: string;
  issuedAt: Date;
  expiresAt: Date;
}>();
