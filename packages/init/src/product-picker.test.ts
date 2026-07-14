import { beforeEach, describe, expect, it, vi } from 'vitest'
import { pickProductInteractive } from './product-picker'
import { listProducts } from './products'

vi.mock('./products', () => ({
  listProducts: vi.fn(),
}))

describe('pickProductInteractive', () => {
  const output: string[] = []

  beforeEach(() => {
    output.length = 0
    vi.clearAllMocks()
    vi.spyOn(process.stdout, 'write').mockImplementation(chunk => {
      output.push(String(chunk))
      return true
    })
  })

  it('skips when no products are found', async () => {
    vi.mocked(listProducts).mockResolvedValue({
      ok: true,
      products: [],
      total: 0,
    })

    const result = await pickProductInteractive('https://api.solvapay.com', 'sk_test', {
      yes: false,
    })

    expect(result).toEqual({ action: 'skipped', reason: 'zero_products' })
    expect(output.join('')).toContain('https://app.solvapay.com/products')
  })

  it('does not report zero products when total is positive', async () => {
    vi.mocked(listProducts).mockResolvedValue({
      ok: true,
      products: [
        {
          reference: 'prd_abc',
          name: 'API Gateway',
          status: '',
          createdAt: '',
        },
      ],
      total: 3,
    })

    const result = await pickProductInteractive('https://api.solvapay.com', 'sk_test', {
      yes: true,
    })

    expect(result).toEqual({ action: 'skipped', reason: 'non_interactive_requires_product' })
    expect(output.join('')).not.toContain('No products found')
  })

  it('requires an explicit product under --yes instead of auto-picking', async () => {
    vi.mocked(listProducts).mockResolvedValue({
      ok: true,
      products: [
        {
          reference: 'prd_newest',
          name: 'Newest',
          status: 'active',
          createdAt: '2026-01-02T00:00:00.000Z',
        },
        {
          reference: 'prd_older',
          name: 'Older',
          status: 'active',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      total: 2,
    })

    const result = await pickProductInteractive('https://api.solvapay.com', 'sk_test', {
      yes: true,
    })

    expect(result).toEqual({ action: 'skipped', reason: 'non_interactive_requires_product' })
    expect(output.join('')).toContain('Skipped product auto-selection in non-interactive mode')
  })

  it('skips on network error', async () => {
    vi.mocked(listProducts).mockResolvedValue({
      ok: false,
      warning: 'network unavailable',
    })

    const result = await pickProductInteractive('https://api.solvapay.com', 'sk_test', {
      yes: false,
    })

    expect(result).toEqual({ action: 'skipped', reason: 'network_error' })
    expect(output.join('')).toContain('Could not list products')
  })
})
