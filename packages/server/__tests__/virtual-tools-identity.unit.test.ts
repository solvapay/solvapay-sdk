import { describe, expect, it, vi } from 'vitest'
import { createVirtualTools } from '../src'
import type { SolvaPayClient } from '../src/types'

const client = () =>
  ({
    getUserInfo: vi.fn().mockResolvedValue({ customerRef: 'cus_1' }),
    createCheckoutSession: vi.fn().mockResolvedValue({ checkoutUrl: 'https://checkout.test' }),
    createCustomerSession: vi.fn().mockResolvedValue({ customerUrl: 'https://portal.test' }),
  }) as unknown as SolvaPayClient & Record<string, ReturnType<typeof vi.fn>>

describe('virtual tools with no customer', () => {
  for (const ref of ['anonymous', '', '  ']) {
    it(`refuse every tool for customer ref ${JSON.stringify(ref)} before calling SolvaPay`, async () => {
      const api = client()
      const tools = createVirtualTools(api, { product: 'prd_vt', getCustomerRef: () => ref })

      for (const tool of tools) {
        const result = (await tool.handler({}, undefined)) as {
          isError?: boolean
          content: Array<{ text: string }>
        }
        expect(result.isError).toBe(true)
        expect(result.content[0].text).toContain('identity required')
      }
      expect(api.getUserInfo).not.toHaveBeenCalled()
      expect(api.createCheckoutSession).not.toHaveBeenCalled()
      expect(api.createCustomerSession).not.toHaveBeenCalled()
    })
  }

  it('still serve a signed-in customer', async () => {
    const api = client()
    const tools = createVirtualTools(api, { product: 'prd_vt', getCustomerRef: () => 'cus_1' })
    for (const tool of tools) {
      const result = (await tool.handler({}, undefined)) as { isError?: boolean }
      expect(result.isError).toBeFalsy()
    }
    expect(api.getUserInfo).toHaveBeenCalledWith({ customerRef: 'cus_1', productRef: 'prd_vt' })
  })
})
