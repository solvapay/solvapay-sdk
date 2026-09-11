import { describe, expect, it } from 'vitest'
import { dockerBuildxPreflight, formatPreflightReport, runPreflight } from './preflight.mjs'

const baseConfig = {
  cwd: '/example',
  wranglerBin: ['pnpm', 'exec', 'wrangler'],
  wranglerEnv: 'dev',
  workerName: 'solvapay-mcp-goldberg-rust-dev',
  dotEnvFile: '.env.dev',
  expectedPublicBaseUrl: 'https://goldberg-rust-dev.solvapay.app',
  requiredVars: [
    'SOLVAPAY_SECRET_KEY',
    'SOLVAPAY_PRODUCT_REF',
    'MCP_PUBLIC_BASE_URL',
    'SOLVAPAY_API_BASE_URL',
  ],
  overridableVars: ['SOLVAPAY_PRODUCT_REF', 'MCP_PUBLIC_BASE_URL', 'SOLVAPAY_API_BASE_URL'],
  requireApiDev: true,
  secretKeyMode: 'dev',
  artifactChecks: [{ path: 'src/assets/mcp-app.html', hint: 'run pnpm build first' }],
  label: 'Goldberg rust dev',
  postDeployNotes: ['  pnpm deploy:dev'],
}

function okEnv() {
  return [
    'SOLVAPAY_SECRET_KEY=sk_test_abc',
    'SOLVAPAY_PRODUCT_REF=prd_abc',
    'MCP_PUBLIC_BASE_URL=https://goldberg-rust-dev.solvapay.app',
    'SOLVAPAY_API_BASE_URL=https://api-dev.solvapay.com',
  ].join('\n')
}

function spawnOk(cmd, args) {
  if (args.includes('whoami')) return { status: 0, stdout: 'logged in' }
  if (args.includes('list')) return { status: 0, stdout: '[\n  { "name": "SOLVAPAY_SECRET_KEY" }\n]' }
  return { status: 0, stdout: '' }
}

describe('runPreflight', () => {
  it('blocks when the dotenv file is missing', () => {
    const result = runPreflight(baseConfig, {
      exists: () => false,
      spawn: spawnOk,
    })
    expect(result.errors.some(e => e.includes('.env.dev missing'))).toBe(true)
  })

  it('blocks placeholder product refs', () => {
    const result = runPreflight(baseConfig, {
      exists: () => true,
      read: () =>
        [
          'SOLVAPAY_SECRET_KEY=sk_test_abc',
          'SOLVAPAY_PRODUCT_REF=prd_your_product_ref',
          'MCP_PUBLIC_BASE_URL=https://goldberg-rust-dev.solvapay.app',
          'SOLVAPAY_API_BASE_URL=https://api-dev.solvapay.com',
        ].join('\n'),
      spawn: spawnOk,
    })
    expect(result.errors.some(e => e.includes('placeholder'))).toBe(true)
  })

  it('blocks sk_live on a dev target unless --allow-live', () => {
    const env = okEnv().replace('sk_test_abc', 'sk_live_abc')
    const blocked = runPreflight(baseConfig, {
      exists: () => true,
      read: () => env,
      spawn: spawnOk,
    })
    expect(blocked.errors.some(e => e.includes('looks like live'))).toBe(true)
    const warned = runPreflight(baseConfig, {
      allowLive: true,
      exists: () => true,
      read: () => env,
      spawn: spawnOk,
    })
    expect(warned.errors.some(e => e.includes('looks like live'))).toBe(false)
    expect(warned.warnings.some(w => w.includes('looks like live'))).toBe(true)
  })

  it('requires the custom-domain public URL and api-dev', () => {
    const result = runPreflight(baseConfig, {
      exists: () => true,
      read: () =>
        [
          'SOLVAPAY_SECRET_KEY=sk_test_abc',
          'SOLVAPAY_PRODUCT_REF=prd_abc',
          'MCP_PUBLIC_BASE_URL=https://wrong.example.com',
          'SOLVAPAY_API_BASE_URL=https://api.solvapay.com',
        ].join('\n'),
      spawn: spawnOk,
    })
    expect(result.errors.some(e => e.includes('goldberg-rust-dev.solvapay.app'))).toBe(true)
    expect(result.errors.some(e => e.includes('api-dev'))).toBe(true)
    expect(result.errors.some(e => e.includes('must not point at production'))).toBe(true)
  })

  it('blocks a missing build artifact', () => {
    const result = runPreflight(baseConfig, {
      exists: path => !String(path).includes('mcp-app.html'),
      read: () => okEnv(),
      spawn: spawnOk,
    })
    expect(result.errors.some(e => e.includes('mcp-app.html missing'))).toBe(true)
  })

  it('blocks when wrangler is logged out or the secret is missing', () => {
    const loggedOut = runPreflight(baseConfig, {
      exists: () => true,
      read: () => okEnv(),
      spawn: () => ({ status: 1, stdout: '' }),
    })
    expect(loggedOut.errors.some(e => e.includes('not authenticated'))).toBe(true)

    const noSecret = runPreflight(baseConfig, {
      exists: () => true,
      read: () => okEnv(),
      spawn: (cmd, args) => {
        if (args.includes('whoami')) return { status: 0, stdout: 'ok' }
        return { status: 0, stdout: '[]' }
      },
    })
    expect(noSecret.errors.some(e => e.includes('SOLVAPAY_SECRET_KEY secret not found'))).toBe(
      true,
    )
  })

  it('passes a complete dev dotenv with auth and secret present', () => {
    const result = runPreflight(baseConfig, {
      exists: () => true,
      read: () => okEnv(),
      spawn: spawnOk,
    })
    expect(result.errors).toEqual([])
    expect(formatPreflightReport(baseConfig, result)).toContain('Ready to deploy')
  })
})

describe('dockerBuildxPreflight', () => {
  it('reports a missing docker daemon', () => {
    const errors = dockerBuildxPreflight({
      spawn: () => ({ status: 1, stdout: '', stderr: 'Cannot connect' }),
    })
    expect(errors[0]).toMatch(/Docker is not running/)
  })

  it('reports missing buildx', () => {
    const errors = dockerBuildxPreflight({
      spawn: (cmd, args) => {
        if (args.includes('info')) return { status: 0, stdout: 'ok' }
        return { status: 1, stdout: '' }
      },
    })
    expect(errors[0]).toMatch(/buildx/)
  })
})
