import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import HomePage from '../../app/page'
import CheckoutPage from '../../app/checkout/page'
import { SolvaPayProvider } from '@solvapay/react'

// Mock useSearchParams hook
vi.mock('next/navigation', () => ({
  useSearchParams: () => ({
    get: (key: string) => {
      const params: Record<string, string> = {
        plan: 'pro',
        return_url: 'http://localhost:3000',
      }
      return params[key] || null
    },
  }),
  useRouter: () => ({
    push: vi.fn(),
    back: vi.fn(),
  }),
}))

// Mock Supabase functions
vi.mock('@/lib/supabase', () => ({
  getUserId: vi.fn(() => Promise.resolve('test-user-id')),
  getAccessToken: vi.fn(() => Promise.resolve('test-token')),
  onAuthStateChange: vi.fn(() => ({
    data: { subscription: { unsubscribe: vi.fn() } },
  })),
}))

// Mock fetch globally
global.fetch = vi.fn()

// Mock window.location
Object.defineProperty(window, 'location', {
  value: {
    href: '',
    assign: vi.fn(),
    replace: vi.fn(),
    reload: vi.fn(),
  },
  writable: true,
})

describe('Integration Tests - User Flows', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(global.fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    })
  })

  describe('Checkout Flow', () => {
    it('displays checkout page with redirect message', () => {
      render(<CheckoutPage />)

      // The checkout page now redirects immediately, showing a loading/redirect message
      expect(screen.getByText('Redirecting to Checkout')).toBeInTheDocument()
      expect(screen.getByText(/Please wait while we redirect you/i)).toBeInTheDocument()
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
            json: () => Promise.resolve({ success: true, tasks: [] }),
          })
        }
        if (url.includes('/api/check-subscription')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ subscriptions: [] }),
          })
        }
        return Promise.resolve({ ok: true })
      })

      // Wrap HomePage with SolvaPayProvider as required
      render(
        <SolvaPayProvider
          customerRef="test-user-id"
          onCustomerRefUpdate={vi.fn()}
          createPayment={vi.fn()}
          checkSubscription={vi.fn(() => Promise.resolve({ subscriptions: [] }))}
        >
          <HomePage />
        </SolvaPayProvider>,
      )

      const testTasksButton = screen.getByRole('button', { name: 'List Tasks' })
      await user.click(testTasksButton)

      await waitFor(() => {
        expect(global.alert).toHaveBeenCalledWith(expect.stringContaining('Tasks List'))
      })
    })
  })
})
