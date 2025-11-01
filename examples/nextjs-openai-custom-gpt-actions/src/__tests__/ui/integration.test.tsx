import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import HomePage from '../../app/page'
import OAuthAuthorizePage from '../../app/oauth/authorize/page'
import CheckoutPage from '../../app/checkout/page'

// Mock useSearchParams hook for OAuth pages
vi.mock('next/navigation', () => ({
  useSearchParams: () => ({
    get: (key: string) => {
      const params: Record<string, string> = {
        'client_id': 'test-client-id',
        'redirect_uri': 'http://localhost:3000/oauth/callback',
        'response_type': 'code',
        'scope': 'openid profile email',
        'state': 'test-state',
        'plan': 'pro',
        'return_url': 'http://localhost:3000'
      }
      return params[key] || null
    }
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

  describe('OAuth Flow', () => {
    it('displays OAuth authorization form', () => {
      render(<OAuthAuthorizePage />)
      
      expect(screen.getByLabelText('Email:')).toBeInTheDocument()
      expect(screen.getByLabelText('Password:')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Login' })).toBeInTheDocument()
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
    it('completes successful API health check', async () => {
      const user = userEvent.setup()
      global.alert = vi.fn()

      ;(global.fetch as any).mockImplementation((url: string) => {
        if (url.includes('/api/healthz')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ ok: true })
          })
        }
        if (url.includes('/api/tasks')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ success: true, tasks: [] })
          })
        }
        return Promise.resolve({ ok: true })
      })

      render(<HomePage />)
      
      const testHealthButton = screen.getByRole('button', { name: 'Test Health' })
      await user.click(testHealthButton)
      
      await waitFor(() => {
        expect(global.alert).toHaveBeenCalledWith(expect.stringContaining('Health Check'))
      })
    })
  })
})
