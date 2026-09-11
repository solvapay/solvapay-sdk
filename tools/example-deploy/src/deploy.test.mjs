import { describe, expect, it } from 'vitest'
import { runDeploy } from './deploy.mjs'

const config = {
  cwd: '/example',
  wranglerBin: ['pnpm', 'exec', 'wrangler'],
  wranglerEnv: 'dev',
  workerName: 'solvapay-mcp-goldberg-python-dev',
  dotEnvFile: '.env.dev',
  expectedPublicBaseUrl: 'https://goldberg-python-dev.solvapay.app',
  requiredVars: [],
  overridableVars: ['SOLVAPAY_PRODUCT_REF', 'MCP_PUBLIC_BASE_URL', 'SOLVAPAY_API_BASE_URL'],
  label: 'python',
}

describe('runDeploy', () => {
  it('warns and deploys placeholders when dotenv is missing', () => {
    const logs = []
    const spawned = []
    const result = runDeploy(config, ['--dry-run'], {
      exists: () => false,
      log: msg => logs.push(msg),
      spawn: (cmd, args) => {
        spawned.push([cmd, ...args])
        return { status: 0 }
      },
    })
    expect(logs.join('\n')).toMatch(/not found — deploying with placeholder vars/)
    expect(result.args).toEqual([
      'pnpm',
      'exec',
      'wrangler',
      'deploy',
      '--env',
      'dev',
      '--dry-run',
    ])
    expect(spawned[0]).toEqual(result.args)
  })

  it('injects overridable vars from dotenv', () => {
    const result = runDeploy(config, [], {
      exists: () => true,
      read: () =>
        [
          'SOLVAPAY_SECRET_KEY=sk_test_abc',
          'SOLVAPAY_PRODUCT_REF=prd_abc',
          'MCP_PUBLIC_BASE_URL=https://goldberg-python-dev.solvapay.app',
          'SOLVAPAY_API_BASE_URL=https://api-dev.solvapay.com',
        ].join('\n'),
      spawn: () => ({ status: 0 }),
    })
    expect(result.args).toEqual([
      'pnpm',
      'exec',
      'wrangler',
      'deploy',
      '--env',
      'dev',
      '--var',
      'SOLVAPAY_PRODUCT_REF:prd_abc',
      '--var',
      'MCP_PUBLIC_BASE_URL:https://goldberg-python-dev.solvapay.app',
      '--var',
      'SOLVAPAY_API_BASE_URL:https://api-dev.solvapay.com',
    ])
  })

  it('uses pywrangler when configured as the wrangler bin', () => {
    const result = runDeploy(
      { ...config, wranglerBin: ['uv', 'run', 'pywrangler'] },
      ['--dry-run'],
      {
        exists: () => false,
        log: () => {},
        spawn: () => ({ status: 0 }),
      },
    )
    expect(result.args.slice(0, 4)).toEqual(['uv', 'run', 'pywrangler', 'deploy'])
  })
})
