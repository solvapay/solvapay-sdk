const widget = {
  path: 'src/assets/mcp-app.html',
  hint: 'run `pnpm build` in examples/typescript/cloudflare-workers-mcp first',
}

const chatgptNotes = url => [
  'Post-deploy (ChatGPT):',
  '  • Add a separate Custom Connector from prod — ChatGPT caches tools/list per connector',
  `  • MCP endpoint: ${url}/mcp`,
]

const goldbergRequired = [
  'SOLVAPAY_SECRET_KEY',
  'SOLVAPAY_PRODUCT_REF',
  'MCP_PUBLIC_BASE_URL',
  'SOLVAPAY_API_BASE_URL',
  'CLOUDFLARE_ACCOUNT_ID',
]

export const example = {
  wranglerEnv: undefined,
  workerName: 'solvapay-mcp-workers-example',
  dotEnvFile: '.env',
  exampleFile: '.env.example',
  expectedPublicBaseUrl: 'https://mcp-workers-example.solvapay.com',
  requiredVars: ['SOLVAPAY_SECRET_KEY', 'SOLVAPAY_PRODUCT_REF', 'MCP_PUBLIC_BASE_URL'],
  requireApiDev: false,
  secretKeyMode: 'dev',
  artifactChecks: [widget],
  label: 'public Workers MCP example',
}

export const dev = {
  wranglerEnv: 'dev',
  workerName: 'solvapay-mcp-goldberg-dev',
  dotEnvFile: '.env.dev',
  exampleFile: '.env.dev.example',
  expectedPublicBaseUrl: 'https://goldberg-demo-dev.solvapay.app',
  requiredVars: goldbergRequired,
  requireApiDev: true,
  secretKeyMode: 'dev',
  artifactChecks: [widget],
  label: 'goldberg-demo dev',
  postDeployNotes: chatgptNotes('https://goldberg-demo-dev.solvapay.app'),
}

export const production = {
  wranglerEnv: 'production',
  workerName: 'solvapay-mcp-goldberg-prod',
  dotEnvFile: '.env.prod',
  exampleFile: '.env.prod.example',
  expectedPublicBaseUrl: 'https://goldberg-demo.solvapay.app',
  requiredVars: ['SOLVAPAY_SECRET_KEY', 'SOLVAPAY_PRODUCT_REF', 'MCP_PUBLIC_BASE_URL'],
  requireApiDev: false,
  secretKeyMode: 'prod',
  artifactChecks: [widget],
  label: 'goldberg-demo prod',
  postDeployNotes: [
    'Post-deploy (ChatGPT):',
    '  • Delete and re-add the Custom Connector so tools/list cache refreshes',
    '  • Verify topup: call topup → iframe → create_payment_intent (purpose: topup) succeeds',
    '  • MCP endpoint: https://goldberg-demo.solvapay.app/mcp',
  ],
}

export default example
