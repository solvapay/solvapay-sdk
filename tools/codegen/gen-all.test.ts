import { describe, expect, it } from 'vitest'
import { runCli } from './gen-all.js'

describe('gen-all CLI', () => {
  it('skips snapshot refresh when the stack is down and runs gen + checks', async () => {
    const invoked: string[][] = []
    const result = await runCli([], {
      liveStack: async () => false,
      run: (_command, args) => {
        invoked.push([...args])
        return 0
      },
    })
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('No live OpenAPI stack')
    expect(result.stdout).toContain('gen:all complete')
    expect(invoked).toEqual([['gen'], ['manifest:check'], ['parity:check']])
  })

  it('refreshes the snapshot when the stack is up', async () => {
    const invoked: string[][] = []
    const result = await runCli([], {
      liveStack: async () => true,
      run: (_command, args) => {
        invoked.push([...args])
        return 0
      },
    })
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Live OpenAPI stack')
    expect(invoked[0]?.[0]).toBe('snapshot:openapi')
  })

  it('surfaces a non-zero pnpm gen exit', async () => {
    const result = await runCli([], {
      liveStack: async () => false,
      run: (_command, args) => (args[0] === 'gen' ? 7 : 0),
    })
    expect(result.exitCode).toBe(7)
    expect(result.stderr).toContain('pnpm gen exited 7')
  })
})
