import { describe, expect, it } from 'vitest'
import { formatZodIssues, parseErrorResult, type CliResult } from './cli.js'

describe('codegen CLI shell', () => {
  it('formats zod issues with paths', () => {
    expect(
      formatZodIssues({
        issues: [
          { path: ['operations', 'checkLimits'], message: 'Required' },
          { path: [], message: 'invalid' },
        ],
      }),
    ).toBe('  - operations.checkLimits: Required\n  - (root): invalid')
  })

  it('wraps parse errors with usage', () => {
    const result: CliResult = parseErrorResult(
      new Error('Unknown argument: --nope'),
      'Usage:\n  pnpm gen\n',
    )
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('Unknown argument: --nope')
    expect(result.stderr).toContain('pnpm gen')
  })
})
