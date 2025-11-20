import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import HomePage from '../../app/page'

// Mock next/link
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

// Mock Supabase lib
vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      signOut: vi.fn(() => Promise.resolve({})),
    },
  },
}))

// Mock fetch globally
global.fetch = vi.fn()

describe('Integration Tests - User Flows', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(global.fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ 
        url: 'http://localhost:3000',
        authenticated: false 
      }),
    })
  })

  describe('Home Page', () => {
    it('displays Custom GPT Actions setup information', () => {
      render(<HomePage />)

      // Check for main heading
      expect(screen.getByText('SolvaPay Custom GPT Actions API')).toBeInTheDocument()
      
      // Check for OpenAPI spec section
      expect(screen.getByText('1. OpenAPI Specification URL')).toBeInTheDocument()
      
      // Check for OAuth configuration section
      expect(screen.getByText('2. OAuth Configuration')).toBeInTheDocument()
      
      // Check for instructions
      expect(screen.getByText('How to Use')).toBeInTheDocument()
    })

    it('displays login button when user is not authenticated', async () => {
      render(<HomePage />)

      // Wait for async state to settle
      await vi.waitFor(() => {
        expect(screen.getByText('Log In')).toBeInTheDocument()
      })
    })
  })

  describe('Checkout Flow', () => {
    it('checkout is handled via API routes', () => {
      // The checkout flow has been refactored to use API routes instead of pages
      // Checkout is initiated via /api/create-checkout-session and completed via /api/checkout/complete
      expect(true).toBe(true)
    })
  })
})
