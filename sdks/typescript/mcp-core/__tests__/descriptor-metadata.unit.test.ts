/**
 * Unit coverage for the pure descriptor-metadata extract (Step 35).
 */

import { describe, expect, it } from 'vitest'
import {
  buildPromptDescriptorMetadata,
  buildPromptUserMessage,
  buildToolDescriptorMetadata,
  deriveIcons,
  MCP_PROMPT_NAMES,
  MCP_TOOL_NAMES,
  PUBLIC_BASE_URL_ERROR,
  validatePublicBaseUrl,
} from '../src'

const ALL_TOOLS = [
  MCP_TOOL_NAMES.account,
  MCP_TOOL_NAMES.createHostedSession,
  MCP_TOOL_NAMES.createPayment,
  MCP_TOOL_NAMES.processPayment,
  MCP_TOOL_NAMES.attachBusinessDetails,
  MCP_TOOL_NAMES.setRenewal,
  MCP_TOOL_NAMES.getHistory,
  MCP_TOOL_NAMES.activatePlan,
] as const

const TRANSPORT_PLUS_ACTIVATE = [
  MCP_TOOL_NAMES.createHostedSession,
  MCP_TOOL_NAMES.createPayment,
  MCP_TOOL_NAMES.processPayment,
  MCP_TOOL_NAMES.attachBusinessDetails,
  MCP_TOOL_NAMES.setRenewal,
  MCP_TOOL_NAMES.getHistory,
  MCP_TOOL_NAMES.activatePlan,
] as const

describe('buildToolDescriptorMetadata', () => {
  it('emits all 8 tools in registration order by default', () => {
    const tools = buildToolDescriptorMetadata({ resourceUri: 'ui://test/view.html' })
    expect(tools.map(t => t.name)).toEqual([...ALL_TOOLS])
  })

  it('keeps the unified account viewer when views is checkout-only', () => {
    const checkoutOnly = buildToolDescriptorMetadata({
      resourceUri: 'ui://test/view.html',
      views: ['checkout'],
    })
    expect(checkoutOnly.map(t => t.name)).toEqual([...ALL_TOOLS])

    const empty = buildToolDescriptorMetadata({
      resourceUri: 'ui://test/view.html',
      views: [],
    })
    expect(empty.map(t => t.name)).toEqual([...TRANSPORT_PLUS_ACTIVATE])
  })

  it('stamps toolMeta vs uiToolMeta correctly', () => {
    const tools = buildToolDescriptorMetadata({ resourceUri: 'ui://x' })
    const account = tools.find(t => t.name === MCP_TOOL_NAMES.account)
    const createPayment = tools.find(t => t.name === MCP_TOOL_NAMES.createPayment)
    expect(account?.meta).toEqual({ ui: { resourceUri: 'ui://x' } })
    expect(createPayment?.meta).toEqual({
      ui: { resourceUri: 'ui://x', visibility: ['app'] },
      audience: 'ui',
      'openai/widgetAccessible': true,
      'openai/visibility': 'private',
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
      MCP_PROMPT_NAMES.upgrade,
      MCP_PROMPT_NAMES.manageAccount,
      MCP_PROMPT_NAMES.topup,
      MCP_PROMPT_NAMES.activatePlan,
    ])
    expect(buildPromptDescriptorMetadata({ views: ['account', 'topup'] }).map(p => p.name)).toEqual(
      [MCP_PROMPT_NAMES.manageAccount, MCP_PROMPT_NAMES.topup, MCP_PROMPT_NAMES.activatePlan],
    )
  })

  it('builds exact user messages', () => {
    expect(buildPromptUserMessage(MCP_PROMPT_NAMES.upgrade, { planRef: 'pln_pro' })).toEqual({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: 'Call the `account` tool with view: "checkout", then activate plan pln_pro.',
          },
        },
      ],
    })
    expect(buildPromptUserMessage(MCP_PROMPT_NAMES.topup, {})).toEqual({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: 'Call the `account` tool with view: "topup" to add SolvaPay credits.',
          },
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
