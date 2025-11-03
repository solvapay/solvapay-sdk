import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import HomePage from '../../app/page'
import CheckoutPage from '../../app/checkout/page'

// Mock useSearchParams hook
vi.mock('next/navigation', () => ({
  useSearchParams: () => ({
    get: (key: string) => {
      const params: Record<string, string> = {
        'plan': 'pro',
        'return_url': 'http://localhost:3000'
      }
      return params[key] || null
    }
  }),
  useRouter: () => ({
    push: vi.fn(),
    back: vi.fn()
  })
}))

// Mock fetch globally
global.fetch = vi.fn()

describe('Integration Tests - User Flows', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(global.fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true })
    })
  })

  describe('Checkout Flow', () => {
    it('displays checkout page with plan selection', () => {
      render(<CheckoutPage />)
      
      expect(screen.getByText('Upgrade Plan')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Upgrade to PRO Plan/i })).toBeInTheDocument()
    })
  })

  describe('API Testing Flow', () => {
    it('completes successful API task check', async () => {
      const user = userEvent.setup()
      global.alert = vi.fn()

      ;(global.fetch as any).mockImplementation((url: string) => {
        if (url.includes('/api/tasks')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ success: true, tasks: [] })
          })
        }
        return Promise.resolve({ ok: true })
      })

      render(<HomePage />)
      
      const testTasksButton = screen.getByRole('button', { name: 'List Tasks' })
      await user.click(testTasksButton)
      
      await waitFor(() => {
        expect(global.alert).toHaveBeenCalledWith(expect.stringContaining('Tasks List'))
      })
    })
  })
})
