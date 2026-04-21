/**
 * Snapshot-style shape test for `buildSolvaPayDescriptors`. Guards the
 * tool list, names, descriptions, and meta envelope so the contract
 * doesn't silently drift between framework adapters.
 */

import { describe, expect, it, vi } from 'vitest'
import { createSolvaPay, type SolvaPayClient } from '@solvapay/server'
import { buildSolvaPayDescriptors, MCP_TOOL_NAMES } from '../src'

function makeSolvaPay() {
  const client = {
    checkLimits: vi.fn().mockResolvedValue({ withinLimits: true, remaining: 1, plan: 'free' }),
    trackUsage: vi.fn().mockResolvedValue(undefined),
    createCustomer: vi.fn().mockResolvedValue({ customerRef: 'cus_new' }),
    getCustomer: vi.fn().mockResolvedValue({ customerRef: 'cus_existing' }),
    getPlatformConfig: vi.fn().mockResolvedValue({ stripePublishableKey: 'pk_test_123' }),
  } as unknown as SolvaPayClient
  return createSolvaPay({ apiClient: client })
}

describe('buildSolvaPayDescriptors', () => {
  it('returns the canonical tool list in a stable shape', () => {
    const { tools, resource } = buildSolvaPayDescriptors({
      solvaPay: makeSolvaPay(),
      productRef: 'prd_test',
      resourceUri: 'ui://test/view.html',
      readHtml: async () => '<html></html>',
      publicBaseUrl: 'https://example.com',
    })

    const names = tools.map(t => t.name).sort()
    expect(names).toEqual(
      [
        MCP_TOOL_NAMES.activatePlan,
        MCP_TOOL_NAMES.cancelRenewal,
        MCP_TOOL_NAMES.checkPurchase,
        MCP_TOOL_NAMES.createCheckoutSession,
        MCP_TOOL_NAMES.createCustomerSession,
        MCP_TOOL_NAMES.createPayment,
        MCP_TOOL_NAMES.createTopupPayment,
        MCP_TOOL_NAMES.getBalance,
        MCP_TOOL_NAMES.getMerchant,
        MCP_TOOL_NAMES.getPaymentMethod,
        MCP_TOOL_NAMES.getProduct,
        MCP_TOOL_NAMES.getUsage,
        MCP_TOOL_NAMES.listPlans,
        MCP_TOOL_NAMES.openAccount,
        MCP_TOOL_NAMES.openCheckout,
        MCP_TOOL_NAMES.openPaywall,
        MCP_TOOL_NAMES.openPlanActivation,
        MCP_TOOL_NAMES.openTopup,
        MCP_TOOL_NAMES.openUsage,
        MCP_TOOL_NAMES.processPayment,
        MCP_TOOL_NAMES.reactivateRenewal,
        MCP_TOOL_NAMES.syncCustomer,
      ].sort(),
    )

    for (const tool of tools) {
      expect(tool.description).toBeTypeOf('string')
      expect(tool.description.length).toBeGreaterThan(10)
      expect(tool.handler).toBeTypeOf('function')
      expect(tool.meta).toEqual({ ui: { resourceUri: 'ui://test/view.html' } })
    }

    expect(resource.uri).toBe('ui://test/view.html')
    expect(resource.mimeType).toBe('text/html;profile=mcp-app')
    expect(resource.readHtml).toBeTypeOf('function')
    expect(resource.csp.resourceDomains).toContain('https://js.stripe.com')
  })

  it('filters open_* tools by views option', () => {
    const { tools } = buildSolvaPayDescriptors({
      solvaPay: makeSolvaPay(),
      productRef: 'prd_test',
      resourceUri: 'ui://test/view.html',
      readHtml: async () => '<html></html>',
      publicBaseUrl: 'https://example.com',
      views: ['checkout'],
    })
    const names = tools.map(t => t.name)
    expect(names).toContain(MCP_TOOL_NAMES.openCheckout)
    expect(names).not.toContain(MCP_TOOL_NAMES.openAccount)
    expect(names).not.toContain(MCP_TOOL_NAMES.openPaywall)
  })

  it('rejects non-http publicBaseUrl', () => {
    expect(() =>
      buildSolvaPayDescriptors({
        solvaPay: makeSolvaPay(),
        productRef: 'prd_test',
        resourceUri: 'ui://test/view.html',
        readHtml: async () => '<html></html>',
        publicBaseUrl: 'ui://nope',
      }),
    ).toThrow(/http\(s\)/)
  })
})
