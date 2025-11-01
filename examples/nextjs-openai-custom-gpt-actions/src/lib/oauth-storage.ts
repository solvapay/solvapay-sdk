// Demo users
export const users = new Map([
  ['demo@example.com', { id: 'user_1', email: 'demo@example.com', name: 'Demo User', password: 'demo123' }],
  ['test@example.com', { id: 'user_2', email: 'test@example.com', name: 'Test User', password: 'test123' }]
]);

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
