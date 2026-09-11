export default {
  wranglerEnv: 'dev',
  workerName: 'solvapay-mcp-goldberg-rust-dev',
  dotEnvFile: '.env.dev',
  exampleFile: '.env.dev.example',
  expectedPublicBaseUrl: 'https://mcp-rust-dev.solvapay.app',
  requiredVars: [
    'SOLVAPAY_SECRET_KEY',
    'SOLVAPAY_PRODUCT_REF',
    'MCP_PUBLIC_BASE_URL',
    'SOLVAPAY_API_BASE_URL',
    'CLOUDFLARE_ACCOUNT_ID',
  ],
  requireApiDev: true,
  secretKeyMode: 'dev',
  label: 'goldberg rust dev',
  postDeployNotes: [
    'MCP endpoint: https://mcp-rust-dev.solvapay.app/mcp',
  ],
}
