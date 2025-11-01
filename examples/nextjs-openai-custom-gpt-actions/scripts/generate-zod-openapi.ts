#!/usr/bin/env tsx

import { config } from 'dotenv';
import { writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi';
import registry from '../src/lib/openapi/registry';

// Load environment variables from .env files (for local development only)
// On Vercel, environment variables are already available in process.env
config({ path: '.env.local' });
config({ path: '.env' });

/**
 * Generate OpenAPI specification from Zod schemas
 * 
 * This script uses @asteasolutions/zod-to-openapi to generate a complete OpenAPI 3.1 
 * specification from Zod schemas and route definitions. This ensures that
 * validation logic and documentation stay in sync.
 */

async function generateOpenApiSpec() {
  console.log('🔍 Generating OpenAPI specification from Zod schemas...');
  
  // Debug: Log environment info
  console.log('🔧 Environment check:');
  console.log('   - NODE_ENV:', process.env.NODE_ENV);
  console.log('   - VERCEL:', process.env.VERCEL);
  console.log('   - PUBLIC_URL:', process.env.PUBLIC_URL ? '✓ Set' : '✗ Missing');
  
  // Require PUBLIC_URL to be explicitly set
  const serverUrl = process.env.PUBLIC_URL;
  
  if (!serverUrl) {
    console.error('❌ Missing required environment variable: PUBLIC_URL');
    console.error('');
    console.error('PUBLIC_URL must be set in Vercel environment variables.');
    console.error('');
    console.error('🔧 How to fix on Vercel:');
    console.error('   1. Go to your project settings: https://vercel.com/[team]/[project]/settings/environment-variables');
    console.error('   2. Add environment variable: PUBLIC_URL');
    console.error('   3. Set value to: https://gpt-demo.solvapay.com (or your custom domain)');
    console.error('   4. ⚠️  IMPORTANT: Check all environment checkboxes:');
    console.error('      ☑ Production');
    console.error('      ☑ Preview');
    console.error('      ☑ Development');
    console.error('   5. Save and redeploy');
    console.error('');
    console.error('💡 For local development:');
    console.error('   Add to .env.local: PUBLIC_URL=https://your-subdomain.ngrok-free.app');
    console.error('');
    console.error('📋 Currently available env vars:', Object.keys(process.env).filter(k => !k.includes('KEY') && !k.includes('SECRET')).sort().join(', '));
    throw new Error('Missing required environment variable: PUBLIC_URL');
  }

  // Reject placeholder URLs
  if (serverUrl.includes('your-domain') || serverUrl.includes('your-subdomain')) {
    console.error('❌ Invalid environment variable value!');
    console.error(`   Current value: ${serverUrl}`);
    console.error('   You cannot use placeholder URLs like "your-domain" or "your-subdomain"');
    console.error('   Please set a real URL like: PUBLIC_URL=https://abc123.ngrok-free.app');
    console.error('   This prevents placeholder URLs from appearing in the OpenAPI schema.');
    throw new Error('Invalid environment variable: Contains placeholder URL');
  }
  
  console.log('🌐 Server URL for OpenAPI:', serverUrl);

  try {
    // Create the OpenAPI generator
    const generator = new OpenApiGeneratorV3(registry.definitions);

    // Generate the complete OpenAPI document
    const document = generator.generateDocument({
      openapi: '3.1.0',
      info: {
        title: 'SolvaPay CRUD API with OAuth (Next.js)',
        version: '1.0.0',
        description: 'A CRUD API with OAuth authentication and paywall protection for OpenAI Custom GPT Actions, built with Next.js. This API provides secure access to user data with proper authentication and usage-based billing.',
        contact: {
          name: 'SolvaPay Support',
          url: 'https://solvapay.com/support',
          email: 'support@solvapay.com'
        },
        license: {
          name: 'MIT',
          url: 'https://opensource.org/licenses/MIT'
        }
      },
      servers: [
        {
          url: serverUrl,
          description: 'API server'
        }
      ],
      tags: [
        {
          name: 'Health',
          description: 'Health check endpoints'
        },
        {
          name: 'OAuth',
          description: 'OAuth 2.0 authentication endpoints for OpenAI Custom GPT integration'
        },
        {
          name: 'User',
          description: 'User account and subscription management'
        },
        {
          name: 'Things',
          description: 'CRUD operations for things with paywall protection'
        }
      ],
      externalDocs: {
        description: 'OpenAI Custom GPT Actions Documentation',
        url: 'https://platform.openai.com/docs/actions'
      }
    });

    // Ensure output directory exists
    const outputPath = 'generated/openapi.json';
    mkdirSync(dirname(outputPath), { recursive: true });

    // Write the generated specification
    writeFileSync(outputPath, JSON.stringify(document, null, 2));

    console.log(`✅ OpenAPI specification generated: ${outputPath}`);
    console.log(`📊 Generated ${Object.keys(document.paths || {}).length} API endpoints`);
    console.log(`🔒 Security: OAuth 2.0 with authorization code flow`);
    console.log(`📖 View docs at: http://localhost:3000/api/docs`);
    console.log(`🎯 Ready for OpenAI Custom GPT Actions integration!`);

    // Validate the generated document
    if (!document.paths || Object.keys(document.paths).length === 0) {
      throw new Error('No API paths were generated - check your registry configuration');
    }

    // Log some statistics
    const pathCount = Object.keys(document.paths).length;
    const schemaCount = Object.keys(document.components?.schemas || {}).length;
    
    console.log(`📈 Statistics:`);
    console.log(`   - API Endpoints: ${pathCount}`);
    console.log(`   - Schemas: ${schemaCount}`);
    console.log(`   - Security Schemes: ${Object.keys(document.components?.securitySchemes || {}).length}`);

    return document;

  } catch (error) {
    console.error('❌ Failed to generate OpenAPI specification:', error);
    
    if (error instanceof Error) {
      console.error('Error details:', error.message);
      console.error('Stack trace:', error.stack);
    }
    
    process.exit(1);
  }
}

// Run the generator
if (require.main === module) {
  generateOpenApiSpec();
}

export { generateOpenApiSpec };