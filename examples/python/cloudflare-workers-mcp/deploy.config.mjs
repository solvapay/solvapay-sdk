const widget = {
  path: 'src/vendor/server-wasm/runtime/mcp-app-html.js',
  hint: 'run `node scripts/stage-server-wasm.mjs` in examples/python/cloudflare-workers-mcp first',
}

export default {
  wranglerBin: ['uv', 'run', 'pywrangler'],
  wranglerEnv: 'dev',
  workerName: 'solvapay-mcp-goldberg-python-dev',
  dotEnvFile: '.env.dev',
  exampleFile: '.env.dev.example',
  expectedPublicBaseUrl: 'https://mcp-python-dev.solvapay.app',
  requiredVars: [
    'SOLVAPAY_SECRET_KEY',
    'SOLVAPAY_PRODUCT_REF',
    'MCP_PUBLIC_BASE_URL',
    'SOLVAPAY_API_BASE_URL',
    'CLOUDFLARE_ACCOUNT_ID',
  ],
  requireApiDev: true,
  secretKeyMode: 'dev',
  artifactChecks: [widget],
  label: 'goldberg python dev',
  postDeployNotes: [
    'Health: https://mcp-python-dev.solvapay.app/health',
    'MCP endpoint: https://mcp-python-dev.solvapay.app/mcp',
  ],
}
