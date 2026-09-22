import { describe, expect, it } from 'vitest'
import { parseCli } from './cli.mjs'

describe('parseCli', () => {
  it('requires a command and --config', () => {
    expect(() => parseCli([])).toThrow(/Usage/)
    expect(() => parseCli(['preflight'])).toThrow(/--config is required/)
  })

  it('strips harness flags and keeps wrangler passthrough', () => {
    expect(
      parseCli([
        'deploy',
        '--config',
        'deploy.config.mjs',
        '--target',
        'dev',
        '--dry-run',
        '--allow-live',
      ]),
    ).toEqual({
      command: 'deploy',
      configPath: 'deploy.config.mjs',
      target: 'dev',
      passthrough: ['--dry-run'],
      allowLive: true,
      allowSandbox: false,
    })
  })
})
