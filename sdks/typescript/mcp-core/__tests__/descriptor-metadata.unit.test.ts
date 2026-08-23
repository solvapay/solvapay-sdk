/**
 * Unit coverage for the pure descriptor-metadata extract (Step 35).
 */

import { describe, expect, it } from 'vitest'
import {
  buildPromptDescriptorMetadata,
  buildPromptUserMessage,
  buildToolDescriptorMetadata,
  deriveIcons,
  MCP_TOOL_NAMES,
  PUBLIC_BASE_URL_ERROR,
  validatePublicBaseUrl,
} from '../src'

describe('buildToolDescriptorMetadata', () => {
  it('emits all 12 tools in registration order by default', () => {
    const tools = buildToolDescriptorMetadata({ resourceUri: 'ui://test/view.html' })
    expect(tools.map(t => t.name)).toEqual([
      MCP_TOOL_NAMES.upgrade,
      MCP_TOOL_NAMES.manageAccount,
      MCP_TOOL_NAMES.topup,
      MCP_TOOL_NAMES.createCheckoutSession,
      MCP_TOOL_NAMES.createPayment,
      MCP_TOOL_NAMES.processPayment,
      MCP_TOOL_NAMES.createCustomerSession,
      MCP_TOOL_NAMES.createTopupPayment,
      MCP_TOOL_NAMES.attachBusinessDetails,
      MCP_TOOL_NAMES.cancelRenewal,
      MCP_TOOL_NAMES.reactivateRenewal,
      MCP_TOOL_NAMES.activatePlan,
    ])
  })

  it('filters intent tools by views and keeps transport + activate_plan', () => {
    const checkoutOnly = buildToolDescriptorMetadata({
      resourceUri: 'ui://test/view.html',
      views: ['checkout'],
    })
    expect(checkoutOnly.map(t => t.name)).toEqual([
      MCP_TOOL_NAMES.upgrade,
      MCP_TOOL_NAMES.createCheckoutSession,
      MCP_TOOL_NAMES.createPayment,
      MCP_TOOL_NAMES.processPayment,
      MCP_TOOL_NAMES.createCustomerSession,
      MCP_TOOL_NAMES.createTopupPayment,
      MCP_TOOL_NAMES.attachBusinessDetails,
      MCP_TOOL_NAMES.cancelRenewal,
      MCP_TOOL_NAMES.reactivateRenewal,
      MCP_TOOL_NAMES.activatePlan,
    ])

    const empty = buildToolDescriptorMetadata({
      resourceUri: 'ui://test/view.html',
      views: [],
    })
    expect(empty.map(t => t.name)).toEqual([
      MCP_TOOL_NAMES.createCheckoutSession,
      MCP_TOOL_NAMES.createPayment,
      MCP_TOOL_NAMES.processPayment,
      MCP_TOOL_NAMES.createCustomerSession,
      MCP_TOOL_NAMES.createTopupPayment,
      MCP_TOOL_NAMES.attachBusinessDetails,
      MCP_TOOL_NAMES.cancelRenewal,
      MCP_TOOL_NAMES.reactivateRenewal,
      MCP_TOOL_NAMES.activatePlan,
    ])
  })

  it('stamps toolMeta vs uiToolMeta correctly', () => {
    const tools = buildToolDescriptorMetadata({ resourceUri: 'ui://x' })
    const upgrade = tools.find(t => t.name === MCP_TOOL_NAMES.upgrade)!
    const createPayment = tools.find(t => t.name === MCP_TOOL_NAMES.createPayment)!
    expect(upgrade.meta).toEqual({ ui: { resourceUri: 'ui://x' } })
    expect(createPayment.meta).toEqual({
      ui: { resourceUri: 'ui://x', visibility: ['app'] },
      audience: 'ui',
      'openai/widgetAccessible': true,
    })
  })

  it('attaches branding icons when present', () => {
    const tools = buildToolDescriptorMetadata({
      resourceUri: 'ui://x',
      branding: { iconUrl: 'https://cdn.example.com/i.png' },
    })
    expect(tools[0]?.icons).toEqual([
      { src: 'https://cdn.example.com/i.png', sizes: ['any', '512x512'] },
    ])
  })
})

describe('buildPromptDescriptorMetadata / buildPromptUserMessage', () => {
  it('emits four prompts for all views and drops checkout prompts when disabled', () => {
    expect(buildPromptDescriptorMetadata().map(p => p.name)).toEqual([
      MCP_TOOL_NAMES.upgrade,
      MCP_TOOL_NAMES.manageAccount,
      MCP_TOOL_NAMES.topup,
      MCP_TOOL_NAMES.activatePlan,
    ])
    expect(buildPromptDescriptorMetadata({ views: ['account'] }).map(p => p.name)).toEqual([
      MCP_TOOL_NAMES.manageAccount,
    ])
  })

  it('builds exact user messages', () => {
    expect(buildPromptUserMessage(MCP_TOOL_NAMES.upgrade, { planRef: 'pln_x' })).toEqual({
      messages: [{ role: 'user', content: { type: 'text', text: 'Activate plan pln_x for me.' } }],
    })
    expect(buildPromptUserMessage(MCP_TOOL_NAMES.topup, {})).toEqual({
      messages: [
        {
          role: 'user',
          content: { type: 'text', text: 'I want to top up my SolvaPay credits.' },
        },
      ],
    })
  })
})

describe('validatePublicBaseUrl / deriveIcons', () => {
  it('returns frozen message or null', () => {
    expect(validatePublicBaseUrl('ui://nope')).toBe(PUBLIC_BASE_URL_ERROR)
    expect(validatePublicBaseUrl('https://example.com')).toBeNull()
  })

  it('covers deriveIcons branches', () => {
    expect(deriveIcons(undefined)).toBeUndefined()
    expect(deriveIcons({ logoUrl: 'https://l' })).toEqual([{ src: 'https://l' }])
  })
})
