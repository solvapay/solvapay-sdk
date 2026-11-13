import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { parseToolArguments } from '../src/internal/parseToolArguments'
import { wrapInputSchema } from '../src/registerPayableTool'

describe('parseToolArguments', () => {
  const schema = wrapInputSchema({ symbol: z.string(), days: z.number().int().default(10) })

  it('applies schema defaults', async () => {
    expect(await parseToolArguments('forecast', schema, { symbol: 'AAPL' })).toEqual({
      ok: true,
      args: { symbol: 'AAPL', days: 10 },
    })
  })

  it('turns invalid arguments into a tool error', async () => {
    const parsed = await parseToolArguments('forecast', schema, { days: 3 })
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.result.isError).toBe(true)
    expect(parsed.result.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('Invalid arguments for tool forecast'),
    })
  })

  it('passes arguments through when the tool declares no schema', async () => {
    expect(await parseToolArguments('ping', undefined, { any: 1 })).toEqual({
      ok: true,
      args: { any: 1 },
    })
  })
})
