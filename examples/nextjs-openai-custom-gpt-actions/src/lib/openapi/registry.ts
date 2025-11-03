import 'dotenv/config';
import { config } from 'dotenv';
import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

// Load environment variables
config({ path: '.env.local' });
config({ path: '.env' });
import {
  // Task schemas
  TaskSchema,
  CreateTaskRequestSchema,
  TaskListSchema,
  PaginationQuerySchema,
  TaskParamsSchema,
  
  // User schemas  
  UserPlanSchema,
  
  // OAuth schemas
  OAuthTokenRequestSchema,
  OAuthTokenResponseSchema,
  UserInfoResponseSchema,
  OAuthAuthorizeQuerySchema,
  JWKSResponseSchema,
  OpenIDConfigurationSchema,
  OAuthRevokeRequestSchema,
  OAuthRevokeResponseSchema,
  SignOutResponseSchema,
  // SignInUrlResponseSchema, // EXCLUDED - kept for reference
  
  // Common schemas
  ErrorResponseSchema
} from '../schemas';

export const registry = new OpenAPIRegistry();

// Register all schemas
registry.register('Task', TaskSchema);
registry.register('CreateTaskRequest', CreateTaskRequestSchema);
registry.register('TaskList', TaskListSchema);
registry.register('UserPlan', UserPlanSchema);
registry.register('OAuthTokenResponse', OAuthTokenResponseSchema);
registry.register('UserInfoResponse', UserInfoResponseSchema);
registry.register('JWKSResponse', JWKSResponseSchema);
registry.register('OpenIDConfiguration', OpenIDConfigurationSchema);
registry.register('OAuthRevokeRequest', OAuthRevokeRequestSchema);
registry.register('OAuthRevokeResponse', OAuthRevokeResponseSchema);
registry.register('SignOutResponse', SignOutResponseSchema);
// registry.register('SignInUrlResponse', SignInUrlResponseSchema); // EXCLUDED - kept for reference
registry.register('ErrorResponse', ErrorResponseSchema);

// Security scheme for OAuth - support multiple URL sources
// Priority: PUBLIC_URL > VERCEL_URL (auto-detected on Vercel)
let baseUrl = process.env.PUBLIC_URL;

// If running on Vercel and no explicit URL is set, use VERCEL_URL
if (!baseUrl && process.env.VERCEL_URL) {
  baseUrl = `https://${process.env.VERCEL_URL}`;
  console.log('📍 [OpenAPI Registry] Using Vercel deployment URL');
}

// Use placeholder only during build if no URL is available
// The actual OpenAPI spec generation will validate and use proper URLs
if (!baseUrl) {
  console.warn('⚠️  [OpenAPI Registry] No URL configured, using placeholder. Set PUBLIC_URL for production.');
  baseUrl = 'https://placeholder.example.com';
}

// Reject user-provided placeholder URLs
if (process.env.PUBLIC_URL && (baseUrl.includes('your-domain') || baseUrl.includes('your-subdomain'))) {
  throw new Error(`Invalid environment variable value: ${baseUrl}. Cannot use placeholder URLs like "your-domain" or "your-subdomain". Please set a real URL.`);
}

registry.registerComponent('securitySchemes', 'oauth2', {
  type: 'oauth2',
  flows: {
    authorizationCode: {
      authorizationUrl: `${baseUrl}/api/oauth/authorize`,
      tokenUrl: `${baseUrl}/api/oauth/token`,
      scopes: {
        openid: 'OpenID scope',
        email: 'Email access',
        profile: 'Profile access'
      }
    }
  }
});

// API endpoints relevant for OpenAI Custom GPT Actions

// Sign-in helper endpoint (EXCLUDED from OpenAPI schema - kept for reference)
// registry.registerPath({
//   method: 'get',
//   path: '/api/auth/signin-url',
//   operationId: 'getSignInUrl',
//   summary: 'Get sign-in URL',
//   description: 'Get the OAuth authorization URL for signing in. This public endpoint helps AI agents guide users through the authentication process without requiring prior authentication.',
//   tags: ['OAuth'],
//   responses: {
//     200: {
//       description: 'Sign-in URL and instructions',
//       content: {
//         'application/json': {
//           schema: SignInUrlResponseSchema
//         }
//       }
//     },
//     500: {
//       description: 'Internal server error',
//       content: {
//         'application/json': {
//           schema: ErrorResponseSchema
//         }
//       }
//     }
//   }
// });

// OAuth endpoints for Custom GPT authentication
registry.registerPath({
  method: 'get',
  path: '/api/.well-known/openid-configuration',
  operationId: 'getOpenIdConfiguration',
  summary: 'OpenID Connect discovery',
  description: 'Get OpenID Connect configuration for OAuth setup',
  tags: ['OAuth'],
  'x-openai-isConsequential': false,
  responses: {
    200: {
      description: 'OpenID Connect configuration',
      content: {
        'application/json': {
          schema: OpenIDConfigurationSchema
        }
      }
    }
  }
});

registry.registerPath({
  method: 'get',
  path: '/api/oauth/authorize',
  operationId: 'authorizeOAuth',
  summary: 'OAuth authorization endpoint',
  description: 'Start OAuth authorization flow',
  tags: ['OAuth'],
  'x-openai-isConsequential': false,
  request: {
    query: OAuthAuthorizeQuerySchema
  },
  responses: {
    302: {
      description: 'Redirect to authorization page'
    },
    400: {
      description: 'Invalid request parameters',
      content: {
        'application/json': {
          schema: ErrorResponseSchema
        }
      }
    }
  }
});

registry.registerPath({
  method: 'post',
  path: '/api/oauth/token',
  operationId: 'exchangeOAuthToken',
  summary: 'OAuth token exchange',
  description: 'Exchange authorization code for access token',
  tags: ['OAuth'],
  'x-openai-isConsequential': false,
  request: {
    body: {
      content: {
        'application/x-www-form-urlencoded': {
          schema: OAuthTokenRequestSchema
        }
      }
    }
  },
  responses: {
    200: {
      description: 'Access token response',
      content: {
        'application/json': {
          schema: OAuthTokenResponseSchema
        }
      }
    },
    400: {
      description: 'Invalid request',
      content: {
        'application/json': {
          schema: ErrorResponseSchema
        }
      }
    }
  }
});

registry.registerPath({
  method: 'get',
  path: '/api/oauth/userinfo',
  operationId: 'getUserInfo',
  summary: 'Get user information',
  description: 'Get authenticated user information',
  tags: ['OAuth'],
  security: [{ oauth2: [] }],
  'x-openai-isConsequential': false,
  responses: {
    200: {
      description: 'User information',
      content: {
        'application/json': {
          schema: UserInfoResponseSchema
        }
      }
    },
    401: {
      description: 'Unauthorized',
      content: {
        'application/json': {
          schema: ErrorResponseSchema
        }
      }
    }
  }
});

registry.registerPath({
  method: 'get',
  path: '/api/oauth/jwks',
  operationId: 'getJwks',
  summary: 'JSON Web Key Set',
  description: 'Get public keys for token verification',
  tags: ['OAuth'],
  'x-openai-isConsequential': false,
  responses: {
    200: {
      description: 'JWKS response',
      content: {
        'application/json': {
          schema: JWKSResponseSchema
        }
      }
    }
  }
});

registry.registerPath({
  method: 'post',
  path: '/api/oauth/revoke',
  operationId: 'revokeOAuthToken',
  summary: 'Revoke OAuth token',
  description: 'Revoke an access token or refresh token to sign out the user',
  tags: ['OAuth'],
  'x-openai-isConsequential': false,
  request: {
    body: {
      content: {
        'application/x-www-form-urlencoded': {
          schema: OAuthRevokeRequestSchema
        }
      }
    }
  },
  responses: {
    200: {
      description: 'Token revoked successfully',
      content: {
        'application/json': {
          schema: OAuthRevokeResponseSchema
        }
      }
    },
    400: {
      description: 'Invalid request',
      content: {
        'application/json': {
          schema: ErrorResponseSchema
        }
      }
    },
    500: {
      description: 'Internal server error',
      content: {
        'application/json': {
          schema: ErrorResponseSchema
        }
      }
    }
  }
});

registry.registerPath({
  method: 'post',
  path: '/api/oauth/signout',
  operationId: 'signOut',
  summary: 'Sign out user',
  description: 'Convenient sign out endpoint that accepts Bearer token in header or form data. Revokes the access token to sign out the user.',
  tags: ['OAuth'],
  security: [{ oauth2: [] }],
  'x-openai-isConsequential': false,
  request: {
    body: {
      content: {
        'application/x-www-form-urlencoded': {
          schema: z.object({
            token: z.string().optional().describe('Token to revoke (optional if using Bearer header)'),
            token_type_hint: z.enum(['access_token', 'refresh_token']).optional().describe('Hint about token type')
          })
        }
      }
    }
  },
  responses: {
    200: {
      description: 'Sign out successful',
      content: {
        'application/json': {
          schema: SignOutResponseSchema
        }
      }
    },
    400: {
      description: 'Invalid request',
      content: {
        'application/json': {
          schema: ErrorResponseSchema
        }
      }
    },
    500: {
      description: 'Internal server error',
      content: {
        'application/json': {
          schema: ErrorResponseSchema
        }
      }
    }
  }
});

// User plan endpoints
registry.registerPath({
  method: 'get',
  path: '/api/user/plan',
  operationId: 'getUserPlan',
  summary: 'Get user plan',
  description: 'Get current user subscription plan and usage information',
  tags: ['User'],
  security: [{ oauth2: [] }],
  'x-openai-isConsequential': false,
  responses: {
    200: {
      description: 'User plan information',
      content: {
        'application/json': {
          schema: UserPlanSchema
        }
      }
    },
    401: {
      description: 'Unauthorized',
      content: {
        'application/json': {
          schema: ErrorResponseSchema
        }
      }
    },
    500: {
      description: 'Internal server error',
      content: {
        'application/json': {
          schema: ErrorResponseSchema
        }
      }
    }
  }
});

// Tasks CRUD endpoints - the main functionality for Custom GPT Actions
registry.registerPath({
  method: 'get',
  path: '/api/tasks',
  operationId: 'listTasks',
  summary: 'List tasks',
  description: 'Get a paginated list of tasks for the authenticated user',
  tags: ['Tasks'],
  security: [{ oauth2: [] }],
  'x-openai-isConsequential': false,
  request: {
    query: PaginationQuerySchema
  },
  responses: {
    200: {
      description: 'List of tasks',
      content: {
        'application/json': {
          schema: TaskListSchema
        }
      }
    },
    401: {
      description: 'Unauthorized',
      content: {
        'application/json': {
          schema: ErrorResponseSchema
        }
      }
    },
    500: {
      description: 'Internal server error',
      content: {
        'application/json': {
          schema: ErrorResponseSchema
        }
      }
    }
  }
});

registry.registerPath({
  method: 'post',
  path: '/api/tasks',
  operationId: 'createTask',
  summary: 'Create task',
  description: 'Create a new task. This endpoint is protected by paywall.',
  tags: ['Tasks'],
  security: [{ oauth2: [] }],
  'x-openai-isConsequential': false,
  request: {
    body: {
      content: {
        'application/json': {
          schema: CreateTaskRequestSchema
        }
      }
    }
  },
  responses: {
    200: {
      description: 'Created task',
      content: {
        'application/json': {
          schema: TaskSchema
        }
      }
    },
    400: {
      description: 'Invalid request body',
      content: {
        'application/json': {
          schema: ErrorResponseSchema
        }
      }
    },
    401: {
      description: 'Unauthorized',
      content: {
        'application/json': {
          schema: ErrorResponseSchema
        }
      }
    },
    402: {
      description: 'Payment required - upgrade to pro plan',
      content: {
        'application/json': {
          schema: ErrorResponseSchema
        }
      }
    },
    500: {
      description: 'Internal server error',
      content: {
        'application/json': {
          schema: ErrorResponseSchema
        }
      }
    }
  }
});

registry.registerPath({
  method: 'get',
  path: '/api/tasks/{id}',
  operationId: 'getTask',
  summary: 'Get task',
  description: 'Get a specific task by its unique identifier',
  tags: ['Tasks'],
  security: [{ oauth2: [] }],
  'x-openai-isConsequential': false,
  request: {
    params: TaskParamsSchema
  },
  responses: {
    200: {
      description: 'Task details',
      content: {
        'application/json': {
          schema: TaskSchema
        }
      }
    },
    401: {
      description: 'Unauthorized',
      content: {
        'application/json': {
          schema: ErrorResponseSchema
        }
      }
    },
    404: {
      description: 'Task not found',
      content: {
        'application/json': {
          schema: ErrorResponseSchema
        }
      }
    },
    500: {
      description: 'Internal server error',
      content: {
        'application/json': {
          schema: ErrorResponseSchema
        }
      }
    }
  }
});

registry.registerPath({
  method: 'delete',
  path: '/api/tasks/{id}',
  operationId: 'deleteTask',
  summary: 'Delete task',
  description: 'Delete a specific task. This endpoint is protected by paywall.',
  tags: ['Tasks'],
  security: [{ oauth2: [] }],
  'x-openai-isConsequential': false,
  request: {
    params: TaskParamsSchema
  },
  responses: {
    200: {
      description: 'Task deleted successfully',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              message: { type: 'string' }
            }
          }
        }
      }
    },
    401: {
      description: 'Unauthorized',
      content: {
        'application/json': {
          schema: ErrorResponseSchema
        }
      }
    },
    402: {
      description: 'Payment required - upgrade to pro plan',
      content: {
        'application/json': {
          schema: ErrorResponseSchema
        }
      }
    },
    404: {
      description: 'Task not found',
      content: {
        'application/json': {
          schema: ErrorResponseSchema
        }
      }
    },
    500: {
      description: 'Internal server error',
      content: {
        'application/json': {
          schema: ErrorResponseSchema
        }
      }
    }
  }
});

// Export the configured registry for use in the generator
export default registry;
