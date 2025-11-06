import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

// Extend Zod with OpenAPI methods
extendZodWithOpenApi(z);

// Common schemas
export const ErrorResponseSchema = z.object({
  error: z.string().describe('Error message'),
  error_description: z.string().optional().describe('Detailed error description')
}).openapi('ErrorResponse');

export const PaywallErrorResponseSchema = z.object({
  error: z.string().describe('Error message'),
  success: z.boolean().describe('Request success status'),
  agent: z.string().describe('The agent that triggered the paywall'),
  checkoutUrl: z.string().describe('URL to upgrade the plan'),
  message: z.string().describe('Human-readable paywall message')
}).openapi('PaywallErrorResponse');

// Task schemas
export const TaskSchema = z.object({
  id: z.string().describe('Unique identifier for the task'),
  title: z.string().describe('Title of the task'),
  description: z.string().optional().describe('Description of the task'),
  completed: z.boolean().describe('Whether the task is completed'),
  createdAt: z.string().datetime().describe('Creation timestamp'),
  updatedAt: z.string().datetime().describe('Last update timestamp')
}).openapi('Task');

export const CreateTaskRequestSchema = z.object({
  title: z.string().min(1).describe('Title of the task to create'),
  description: z.string().optional().describe('Optional description of the task')
}).openapi('CreateTaskRequest');

export const TaskListSchema = z.object({
  tasks: z.array(TaskSchema).describe('Array of tasks'),
  total: z.number().describe('Total number of tasks available'),
  limit: z.number().describe('Number of items per page'),
  offset: z.number().describe('Number of items skipped')
}).openapi('TaskList');

// Query parameter schemas
export const PaginationQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(10).describe('Number of items to return'),
  offset: z.coerce.number().min(0).default(0).describe('Number of items to skip')
});

export const TaskParamsSchema = z.object({
  id: z.string().describe('The unique identifier of the task')
});

// User Plan schemas
export const UserPlanSchema = z.object({
  plan: z.enum(['free', 'pro']).describe('Current subscription plan'),
  usage: z.object({
    api_calls: z.number().describe('Number of API calls made'),
    last_reset: z.string().datetime().describe('Last usage reset timestamp')
  }).describe('Current usage statistics'),
  limits: z.object({
    api_calls: z.number().describe('Maximum API calls allowed'),
    reset_period: z.string().describe('Usage reset period')
  }).describe('Plan limits'),
  upgradedAt: z.string().datetime().optional().describe('Timestamp when plan was upgraded')
}).openapi('UserPlan');

// OAuth schemas
export const OAuthTokenRequestSchema = z.object({
  grant_type: z.literal('authorization_code').describe('OAuth grant type'),
  code: z.string().describe('Authorization code'),
  redirect_uri: z.string().url().describe('Redirect URI'),
  client_id: z.string().describe('OAuth client ID'),
  client_secret: z.string().optional().describe('OAuth client secret')
});

export const OAuthTokenResponseSchema = z.object({
  access_token: z.string().describe('Access token'),
  token_type: z.literal('Bearer').describe('Token type'),
  expires_in: z.number().describe('Token expiration time in seconds'),
  refresh_token: z.string().describe('Refresh token'),
  scope: z.string().describe('Granted scopes')
}).openapi('OAuthTokenResponse');

export const UserInfoResponseSchema = z.object({
  sub: z.string().describe('Subject identifier'),
  email: z.string().email().describe('User email address'),
  name: z.string().describe('User display name')
}).openapi('UserInfoResponse');

export const OAuthAuthorizeQuerySchema = z.object({
  client_id: z.string().describe('OAuth client ID'),
  redirect_uri: z.string().url().describe('Redirect URI'),
  response_type: z.literal('code').describe('OAuth response type'),
  scope: z.string().optional().describe('OAuth scopes'),
  state: z.string().optional().describe('State parameter for CSRF protection')
});

export const JWKSResponseSchema = z.object({
  keys: z.array(z.object({
    kty: z.string().describe('Key type'),
    use: z.string().describe('Key use'),
    kid: z.string().describe('Key ID'),
    n: z.string().describe('RSA modulus'),
    e: z.string().describe('RSA exponent')
  })).describe('JSON Web Keys')
}).openapi('JWKSResponse');

// OpenID Configuration schema
export const OpenIDConfigurationSchema = z.object({
  issuer: z.string().url().describe('OAuth issuer URL'),
  authorization_endpoint: z.string().url().describe('Authorization endpoint URL'),
  token_endpoint: z.string().url().describe('Token endpoint URL'),
  userinfo_endpoint: z.string().url().describe('UserInfo endpoint URL'),
  jwks_uri: z.string().url().describe('JWKS endpoint URL'),
  revocation_endpoint: z.string().url().describe('Token revocation endpoint URL'),
  scopes_supported: z.array(z.string()).describe('Supported OAuth scopes'),
  response_types_supported: z.array(z.string()).describe('Supported response types'),
  grant_types_supported: z.array(z.string()).describe('Supported grant types'),
  subject_types_supported: z.array(z.string()).describe('Supported subject types')
}).openapi('OpenIDConfiguration');

// OAuth Token Revocation schemas
export const OAuthRevokeRequestSchema = z.object({
  token: z.string().describe('The token to revoke (access_token or refresh_token)'),
  token_type_hint: z.enum(['access_token', 'refresh_token']).optional().describe('Hint about the type of token being revoked')
}).openapi('OAuthRevokeRequest');

export const OAuthRevokeResponseSchema = z.object({
  revoked: z.boolean().describe('Whether the token was successfully revoked'),
  message: z.string().describe('Status message')
}).openapi('OAuthRevokeResponse');

// Sign out response schema
export const SignOutResponseSchema = z.object({
  success: z.boolean().describe('Whether the sign out was successful'),
  message: z.string().describe('Status message')
}).openapi('SignOutResponse');

// Sign in URL response schema
export const SignInUrlResponseSchema = z.object({
  signInUrl: z.string().url().describe('The complete OAuth authorization URL for signing in'),
  instructions: z.string().describe('Human-readable instructions for the user')
}).openapi('SignInUrlResponse');

// Type exports for use in API routes
export type Task = z.infer<typeof TaskSchema>;
export type CreateTaskRequest = z.infer<typeof CreateTaskRequestSchema>;
export type TaskList = z.infer<typeof TaskListSchema>;
export type UserPlan = z.infer<typeof UserPlanSchema>;
export type OAuthTokenRequest = z.infer<typeof OAuthTokenRequestSchema>;
export type OAuthTokenResponse = z.infer<typeof OAuthTokenResponseSchema>;
export type UserInfoResponse = z.infer<typeof UserInfoResponseSchema>;
export type JWKSResponse = z.infer<typeof JWKSResponseSchema>;
export type OpenIDConfiguration = z.infer<typeof OpenIDConfigurationSchema>;
export type OAuthRevokeRequest = z.infer<typeof OAuthRevokeRequestSchema>;
export type OAuthRevokeResponse = z.infer<typeof OAuthRevokeResponseSchema>;
export type SignOutResponse = z.infer<typeof SignOutResponseSchema>;
export type SignInUrlResponse = z.infer<typeof SignInUrlResponseSchema>;
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
