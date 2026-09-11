import { dockerBuildxPreflight } from '@solvapay/example-deploy'

const containerVars = {
  requiredVars: [
    'SOLVAPAY_SECRET_KEY',
    'SOLVAPAY_PRODUCT',
    'MCP_PUBLIC_BASE_URL',
    'SOLVAPAY_API_BASE_URL',
    'CLOUDFLARE_ACCOUNT_ID',
  ],
  overridableVars: ['SOLVAPAY_PRODUCT', 'MCP_PUBLIC_BASE_URL', 'SOLVAPAY_API_BASE_URL'],
  requireApiDev: true,
  secretKeyMode: 'dev',
  extraPreflight({ errors, spawn }) {
    errors.push(...dockerBuildxPreflight({ spawn }))
  },
}

export const go = {
  ...containerVars,
  wranglerEnv: 'go',
  workerName: 'solvapay-mcp-goldberg-go-dev',
  dotEnvFile: '.env.go.dev',
  exampleFile: '.env.go.dev.example',
  expectedPublicBaseUrl: 'https://goldberg-go-dev.solvapay.app',
  label: 'goldberg go container dev',
  postDeployNotes: ['MCP endpoint: https://goldberg-go-dev.solvapay.app/mcp'],
}

export const ruby = {
  ...containerVars,
  wranglerEnv: 'ruby',
  workerName: 'solvapay-mcp-goldberg-ruby-dev',
  dotEnvFile: '.env.ruby.dev',
  exampleFile: '.env.ruby.dev.example',
  expectedPublicBaseUrl: 'https://goldberg-ruby-dev.solvapay.app',
  label: 'goldberg ruby container dev',
  postDeployNotes: ['MCP endpoint: https://goldberg-ruby-dev.solvapay.app/mcp'],
}

export default go
