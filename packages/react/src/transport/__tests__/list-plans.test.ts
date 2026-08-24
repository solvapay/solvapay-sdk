import { describe, it, expect, vi, beforeEach } from 'vitest'

import { defaultListPlans } from '../list-plans'

describe('defaultListPlans', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('surfaces server error message from JSON body on non-OK responses', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: 'SolvaPay API is unreachable at SOLVAPAY_API_BASE_URL',
        }),
        { status: 500, statusText: 'Internal Server Error' },
      ),
    )

    await expect(
      defaultListPlans('prd_test', { fetch: fetchFn as unknown as typeof fetch }),
    ).rejects.toThrow('SolvaPay API is unreachable at SOLVAPAY_API_BASE_URL')
  })

  it('falls back to status text when response body has no error field', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({}), {
        status: 502,
        statusText: 'Bad Gateway',
      }),
    )

    await expect(
      defaultListPlans('prd_test', { fetch: fetchFn as unknown as typeof fetch }),
    ).rejects.toThrow('Failed to fetch plans: Bad Gateway')
  })
})
