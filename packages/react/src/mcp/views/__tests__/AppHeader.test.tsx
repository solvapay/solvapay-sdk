import { render, fireEvent } from '@testing-library/react'
import { describe, it, expect, beforeEach } from 'vitest'
import React from 'react'
import { AppHeader } from '../AppHeader'
import { McpHostInfoProvider } from '../../hooks/useHostInfo'
import { SolvaPayContext } from '../../../SolvaPayProvider'
import { merchantCache } from '../../../hooks/useMerchant'
import { createTransportCacheKey } from '../../../transport/cache-key'
import type {
  Merchant,
  SolvaPayConfig,
  SolvaPayContextValue,
} from '../../../types'

function makeTransport(): NonNullable<SolvaPayConfig['transport']> {
  return {
    checkPurchase: async () => ({ purchases: [] }),
    createPayment: async () => ({ clientSecret: '', paymentIntentId: '' }),
    processPayment: async () => ({ success: true }),
    createTopupPayment: async () => ({ clientSecret: '', paymentIntentId: '' }),
    getBalance: async () => ({
      credits: 0,
      displayCurrency: 'USD',
      creditsPerMinorUnit: 100,
      displayExchangeRate: 1,
    }),
    cancelRenewal: async () => ({ success: true }),
    reactivateRenewal: async () => ({ success: true }),
    activatePlan: async () => ({ success: true }),
    createCheckoutSession: async () => ({ checkoutUrl: '' }),
    createCustomerSession: async () => ({ customerUrl: '' }),
    getMerchant: async () => null as unknown as Merchant,
    getProduct: async () => null,
    listPlans: async () => [],
    getPaymentMethod: async () => null,
  } as unknown as NonNullable<SolvaPayConfig['transport']>
}

function seedMerchant(merchant: Merchant | null): SolvaPayConfig {
  const config: SolvaPayConfig = { transport: makeTransport() }
  const key = createTransportCacheKey(config, '/api/merchant')
  merchantCache.set(key, { merchant, promise: null, timestamp: Date.now() })
  return config
}

function buildCtx(config: SolvaPayConfig): SolvaPayContextValue {
  return {
    _config: config,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

function renderWithContext(
  node: React.ReactNode,
  opts: { config?: SolvaPayConfig; hostName?: string | null } = {},
) {
  const { config, hostName = null } = opts
  const tree = (
    <McpHostInfoProvider hostName={hostName}>{node}</McpHostInfoProvider>
  )
  if (!config) return render(tree)
  return render(
    <SolvaPayContext.Provider value={buildCtx(config)}>
      {tree}
    </SolvaPayContext.Provider>,
  )
}

describe('<AppHeader>', () => {
  beforeEach(() => {
    merchantCache.clear()
  })

  describe('icon fallback chain', () => {
    it('renders <img> when merchant.iconUrl is present', () => {
      const config = seedMerchant({
        displayName: 'Acme',
        legalName: 'Acme Inc.',
        iconUrl: 'https://acme.test/icon.png',
        logoUrl: 'https://acme.test/logo.png',
      })
      const { container } = renderWithContext(<AppHeader />, { config })
      const img = container.querySelector('img.solvapay-mcp-app-header-icon') as
        | HTMLImageElement
        | null
      expect(img).not.toBeNull()
      expect(img?.src).toBe('https://acme.test/icon.png')
    })

    it('falls back to logoUrl when iconUrl is missing', () => {
      const config = seedMerchant({
        displayName: 'Acme',
        legalName: 'Acme Inc.',
        logoUrl: 'https://acme.test/logo.png',
      })
      const { container } = renderWithContext(<AppHeader />, { config })
      const img = container.querySelector('img.solvapay-mcp-app-header-icon') as
        | HTMLImageElement
        | null
      expect(img?.src).toBe('https://acme.test/logo.png')
    })

    it('falls back to initials bubble when both URLs are missing', () => {
      const config = seedMerchant({
        displayName: 'Acme Corp',
        legalName: 'Acme Inc.',
      })
      const { container } = renderWithContext(<AppHeader />, { config })
      expect(container.querySelector('img.solvapay-mcp-app-header-icon')).toBeNull()
      const initials = container.querySelector(
        '.solvapay-mcp-app-header-initials',
      )
      expect(initials?.textContent).toBe('AC')
    })

    it('keeps initials visible until <img> fires onLoad, then swaps in the icon', () => {
      // Without this placeholder the iframe flashes `initials → blank
      // 20×20 frame → real icon` while the browser decodes the image.
      // We mount the `<img>` immediately (so `onLoad` can fire) but
      // hide it with `display:none`, and leave the initials bubble in
      // place as the placeholder until the pixels actually land.
      const config = seedMerchant({
        displayName: 'Acme Corp',
        legalName: 'Acme Inc.',
        iconUrl: 'https://acme.test/icon.png',
      })
      const { container } = renderWithContext(<AppHeader />, { config })
      const img = container.querySelector<HTMLImageElement>(
        'img.solvapay-mcp-app-header-icon',
      )
      expect(img).not.toBeNull()
      expect(img?.style.display).toBe('none')
      const initialsBefore = container.querySelector(
        '.solvapay-mcp-app-header-initials',
      )
      expect(initialsBefore?.textContent).toBe('AC')

      fireEvent.load(img as HTMLImageElement)

      const imgAfter = container.querySelector<HTMLImageElement>(
        'img.solvapay-mcp-app-header-icon',
      )
      expect(imgAfter).not.toBeNull()
      expect(imgAfter?.style.display).toBe('')
      expect(
        container.querySelector('.solvapay-mcp-app-header-initials'),
      ).toBeNull()
    })

    it('skips the initials flash when the image is already complete on mount (warm cache)', () => {
      // `<McpApp>` preloads the merchant icon via `<link rel="preload">`
      // before `<AppHeader>` mounts, so the `<img>` element often
      // lands with `complete === true` on its first commit.
      // `<AppHeader>`'s layout effect has to synchronously flip
      // `imgLoaded` to `true` before paint — otherwise the initials
      // bubble paints for one frame (the "initials flash"). This test
      // stubs `HTMLImageElement`'s `complete` / `naturalHeight`
      // getters so the probe reports a warm cache, and asserts the
      // first observable render shows only the icon (no `display:none`,
      // no initials bubble).
      const completeDescriptor = Object.getOwnPropertyDescriptor(
        HTMLImageElement.prototype,
        'complete',
      )
      const naturalHeightDescriptor = Object.getOwnPropertyDescriptor(
        HTMLImageElement.prototype,
        'naturalHeight',
      )
      Object.defineProperty(HTMLImageElement.prototype, 'complete', {
        configurable: true,
        get() {
          return true
        },
      })
      Object.defineProperty(HTMLImageElement.prototype, 'naturalHeight', {
        configurable: true,
        get() {
          return 20
        },
      })
      try {
        const config = seedMerchant({
          displayName: 'Acme Corp',
          legalName: 'Acme Inc.',
          iconUrl: 'https://acme.test/icon.png',
        })
        const { container } = renderWithContext(<AppHeader />, { config })
        const img = container.querySelector<HTMLImageElement>(
          'img.solvapay-mcp-app-header-icon',
        )
        expect(img).not.toBeNull()
        expect(img?.style.display).toBe('')
        expect(
          container.querySelector('.solvapay-mcp-app-header-initials'),
        ).toBeNull()
      } finally {
        if (completeDescriptor) {
          Object.defineProperty(HTMLImageElement.prototype, 'complete', completeDescriptor)
        } else {
          delete (HTMLImageElement.prototype as unknown as { complete?: unknown })
            .complete
        }
        if (naturalHeightDescriptor) {
          Object.defineProperty(
            HTMLImageElement.prototype,
            'naturalHeight',
            naturalHeightDescriptor,
          )
        } else {
          delete (HTMLImageElement.prototype as unknown as {
            naturalHeight?: unknown
          }).naturalHeight
        }
      }
    })

    it('falls back to initials bubble when the image fails to load (onError)', () => {
      // Merchant has a logo URL but the file 404s / CSP blocks it /
      // CDN is down. Without the onError fallback the browser shows
      // its broken-image icon; with it, we swap to the initials
      // bubble — same UX as a merchant without a logo.
      const config = seedMerchant({
        displayName: 'Acme Corp',
        legalName: 'Acme Inc.',
        iconUrl: 'https://example.test/broken/icon.png',
      })
      const { container } = renderWithContext(<AppHeader />, { config })
      const img = container.querySelector('img.solvapay-mcp-app-header-icon')
      expect(img).not.toBeNull()
      // Simulate the browser's image-load failure.
      fireEvent.error(img as HTMLImageElement)
      expect(container.querySelector('img.solvapay-mcp-app-header-icon')).toBeNull()
      const initials = container.querySelector(
        '.solvapay-mcp-app-header-initials',
      )
      expect(initials?.textContent).toBe('AC')
    })
  })

  describe('merchant name fallback', () => {
    it('uses merchant.displayName when resolved', () => {
      const config = seedMerchant({
        displayName: 'Parcel code',
        legalName: 'Parcel Inc.',
      })
      const { container } = renderWithContext(<AppHeader />, { config })
      expect(container.querySelector('.solvapay-mcp-app-header-name')?.textContent).toBe(
        'Parcel code',
      )
    })

    it('falls back to "SolvaPay" when no merchant is cached', () => {
      // No SolvaPayContext, no cache entry — pre-bootstrap scenario.
      const { container } = renderWithContext(<AppHeader />)
      expect(container.querySelector('.solvapay-mcp-app-header-name')?.textContent).toBe(
        'SolvaPay',
      )
      expect(container.querySelector('.solvapay-mcp-app-header-initials')?.textContent).toBe(
        'SP',
      )
    })
  })

  describe('host-aware rendering (mode="auto")', () => {
    it('suppresses the strip on Claude Desktop (host paints its own merchant chrome)', () => {
      // Claude Desktop paints an MCP app chrome strip (app icon +
      // app name + active tool name) above every widget iframe, so
      // rendering our own `[icon] Merchant` row below it stacks two
      // brand rows. Matches ChatGPT's suppression semantics.
      const config = seedMerchant({ displayName: 'Acme', legalName: 'Acme Inc.' })
      const { container } = renderWithContext(<AppHeader />, {
        config,
        hostName: 'Claude Desktop',
      })
      expect(container.querySelector('.solvapay-mcp-app-header')).toBeNull()
    })

    it('suppresses on any host containing "claude" (case-insensitive)', () => {
      const config = seedMerchant({ displayName: 'Acme', legalName: 'Acme Inc.' })
      const { container } = renderWithContext(<AppHeader />, {
        config,
        hostName: 'Claude Code',
      })
      expect(container.querySelector('.solvapay-mcp-app-header')).toBeNull()
    })

    it('renders the strip on MCP Jam', () => {
      const config = seedMerchant({ displayName: 'Acme', legalName: 'Acme Inc.' })
      const { container } = renderWithContext(<AppHeader />, {
        config,
        hostName: 'MCP Jam',
      })
      expect(container.querySelector('.solvapay-mcp-app-header')).not.toBeNull()
    })

    it('suppresses the strip on ChatGPT (host paints its own merchant chrome)', () => {
      const config = seedMerchant({ displayName: 'Acme', legalName: 'Acme Inc.' })
      const { container } = renderWithContext(<AppHeader />, {
        config,
        hostName: 'ChatGPT',
      })
      expect(container.querySelector('.solvapay-mcp-app-header')).toBeNull()
    })

    it('suppresses on any host containing "openai" (case-insensitive)', () => {
      const config = seedMerchant({ displayName: 'Acme', legalName: 'Acme Inc.' })
      const { container } = renderWithContext(<AppHeader />, {
        config,
        hostName: 'OpenAI Apps',
      })
      expect(container.querySelector('.solvapay-mcp-app-header')).toBeNull()
    })

    it('renders when hostName is null (unknown / pre-handshake — safe fallback)', () => {
      const config = seedMerchant({ displayName: 'Acme', legalName: 'Acme Inc.' })
      const { container } = renderWithContext(<AppHeader />, {
        config,
        hostName: null,
      })
      expect(container.querySelector('.solvapay-mcp-app-header')).not.toBeNull()
    })
  })

  describe('mode override', () => {
    it('mode="always" renders even on ChatGPT', () => {
      const config = seedMerchant({ displayName: 'Acme', legalName: 'Acme Inc.' })
      const { container } = renderWithContext(<AppHeader mode="always" />, {
        config,
        hostName: 'ChatGPT',
      })
      expect(container.querySelector('.solvapay-mcp-app-header')).not.toBeNull()
    })

    it('mode="never" suppresses even on MCP Jam (host that auto-renders)', () => {
      // MCP Jam leaves branding to the app, so `mode="auto"` renders
      // there; this locks in that `mode="never"` overrides the
      // auto-render path. (Claude Desktop is now auto-suppressed, so
      // using it here wouldn't exercise the override.)
      const config = seedMerchant({ displayName: 'Acme', legalName: 'Acme Inc.' })
      const { container } = renderWithContext(<AppHeader mode="never" />, {
        config,
        hostName: 'MCP Jam',
      })
      expect(container.querySelector('.solvapay-mcp-app-header')).toBeNull()
    })
  })

  describe('classNames overrides', () => {
    it('swaps slot classes when classNames are provided', () => {
      const config = seedMerchant({
        displayName: 'Acme',
        legalName: 'Acme Inc.',
        logoUrl: 'https://acme.test/logo.png',
      })
      const { container } = renderWithContext(
        <AppHeader
          classNames={{
            appHeader: 'my-header',
            appHeaderIcon: 'my-icon',
            appHeaderName: 'my-name',
          }}
        />,
        { config },
      )
      expect(container.querySelector('header.my-header')).not.toBeNull()
      expect(container.querySelector('img.my-icon')).not.toBeNull()
      expect(container.querySelector('span.my-name')).not.toBeNull()
      // Defaults should be gone.
      expect(container.querySelector('.solvapay-mcp-app-header')).toBeNull()
    })

    it('classNames: "" disables the default for that slot', () => {
      const config = seedMerchant({
        displayName: 'Acme',
        legalName: 'Acme Inc.',
      })
      const { container } = renderWithContext(
        <AppHeader classNames={{ appHeaderName: '' }} />,
        { config },
      )
      // Name span still renders, just without a class.
      const name = container.querySelector('header')?.querySelector('span:not([aria-hidden])')
      expect(name?.textContent).toBe('Acme')
      expect(name?.getAttribute('class')).toBe('')
    })
  })

  describe('explicit `merchant` prop', () => {
    // `<McpApp>` mounts `<AppHeader>` above its conditional
    // `<SolvaPayProvider>` tree so the merchant mark persists across
    // loading / error / ready states. In that slot the context /
    // cache read returns `null`, so the bootstrap merchant is passed
    // in directly — these tests lock that path in.
    it('paints the prop merchant when no context is available', () => {
      const { container } = renderWithContext(
        <AppHeader
          merchant={{
            displayName: 'Prop Merchant',
            legalName: 'Prop Merchant Inc.',
            iconUrl: 'https://prop.test/icon.png',
          }}
        />,
      )
      const img = container.querySelector('img.solvapay-mcp-app-header-icon') as
        | HTMLImageElement
        | null
      expect(img?.src).toBe('https://prop.test/icon.png')
      expect(
        container.querySelector('.solvapay-mcp-app-header-name')?.textContent,
      ).toBe('Prop Merchant')
    })

    it('prefers the prop merchant over a cached one', () => {
      const config = seedMerchant({
        displayName: 'Cached Merchant',
        legalName: 'Cached Inc.',
        iconUrl: 'https://cached.test/icon.png',
      })
      const { container } = renderWithContext(
        <AppHeader
          merchant={{
            displayName: 'Prop Merchant',
            legalName: 'Prop Merchant Inc.',
            iconUrl: 'https://prop.test/icon.png',
          }}
        />,
        { config },
      )
      expect(
        container.querySelector('.solvapay-mcp-app-header-name')?.textContent,
      ).toBe('Prop Merchant')
      const img = container.querySelector('img.solvapay-mcp-app-header-icon') as
        | HTMLImageElement
        | null
      expect(img?.src).toBe('https://prop.test/icon.png')
    })

    it('merchant={null} forces the SolvaPay fallback even when a merchant is cached', () => {
      const config = seedMerchant({
        displayName: 'Cached Merchant',
        legalName: 'Cached Inc.',
        iconUrl: 'https://cached.test/icon.png',
      })
      const { container } = renderWithContext(<AppHeader merchant={null} />, {
        config,
      })
      expect(
        container.querySelector('.solvapay-mcp-app-header-name')?.textContent,
      ).toBe('SolvaPay')
      expect(
        container.querySelector('.solvapay-mcp-app-header-initials')?.textContent,
      ).toBe('SP')
    })

    it('merchant=undefined falls through to the cache (default behaviour)', () => {
      const config = seedMerchant({
        displayName: 'Cached Merchant',
        legalName: 'Cached Inc.',
      })
      const { container } = renderWithContext(<AppHeader />, { config })
      expect(
        container.querySelector('.solvapay-mcp-app-header-name')?.textContent,
      ).toBe('Cached Merchant')
    })
  })

  describe('children slot', () => {
    it('renders children inside the right-side slot', () => {
      const config = seedMerchant({
        displayName: 'Acme',
        legalName: 'Acme Inc.',
      })
      const { container } = renderWithContext(
        <AppHeader>
          <button type="button" data-testid="close">
            close
          </button>
        </AppHeader>,
        { config },
      )
      const slot = container.querySelector('.solvapay-mcp-app-header-slot')
      expect(slot).not.toBeNull()
      expect(slot?.querySelector('[data-testid="close"]')).not.toBeNull()
    })

    it('omits the slot wrapper when children is absent', () => {
      const config = seedMerchant({ displayName: 'Acme', legalName: 'Acme Inc.' })
      const { container } = renderWithContext(<AppHeader />, { config })
      expect(container.querySelector('.solvapay-mcp-app-header-slot')).toBeNull()
    })
  })
})
