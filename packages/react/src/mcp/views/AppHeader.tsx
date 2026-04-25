'use client'

/**
 * `<AppHeader>` — compact merchant strip rendered at the top of every
 * MCP surface (icon + merchant name in a muted color).
 *
 * **Host-aware.** On hosts that paint their own merchant chrome,
 * `<AppHeader>` renders nothing in `mode="auto"` so we don't duplicate
 * branding. Today that covers:
 *   - **ChatGPT**, per OpenAI's Apps SDK UI guidelines — *"Do not
 *     include your logo as part of the response. ChatGPT will always
 *     append your logo and app name before the widget is rendered."*
 *   - **Claude Desktop**, which paints an MCP app chrome strip (app
 *     icon + app name + tool name) above every widget iframe, so a
 *     second in-widget merchant row is redundant.
 *
 * On MCP Jam, VS Code, and other hosts that leave in-widget branding
 * to the app, `<AppHeader>` paints the standard `[icon] Merchant` row
 * so the user always sees who they're dealing with.
 *
 * `<McpApp>` renders this once as a chrome row above the shell, so
 * every surface (loading, error, checkout, account, topup) shares one
 * merchant mark. Integrators composing their own shells can import it
 * and drop it anywhere a merchant mark is needed — it reads
 * `useMerchant()` and `useHostName()` internally, so no props are
 * required in typical usage.
 */

import React, { useContext, useLayoutEffect, useRef, useState } from 'react'
import { SolvaPayContext } from '../../SolvaPayProvider'
import { merchantCache } from '../../hooks/useMerchant'
import { createTransportCacheKey } from '../../transport/cache-key'
import type { Merchant } from '../../types'
import { useHostName } from '../hooks/useHostInfo'
import { resolveMcpClassNames, type McpViewClassNames } from './types'

/**
 * Matches host names whose chrome already paints a merchant mark.
 *
 * - **ChatGPT / OpenAI Apps SDK** explicitly prohibits in-widget
 *   logos; its inline display always shows *"A label with the app
 *   name and icon"* above the iframe.
 * - **Claude Desktop** paints its own MCP app chrome strip (app icon
 *   + app name + active tool name) above every widget iframe. Adding
 *   an in-widget merchant row below it produces a stacked-branding
 *   look.
 *
 * Substring match (case-insensitive) so host variants like
 * `"Claude Code"` / `"OpenAI Apps"` collapse under the same rule.
 * Add new hosts here as their UI guidelines or behaviour start
 * painting their own mark. Integrators can override per-mount with
 * `mode="always"` or `mode="never"`.
 */
export const HOSTS_WITH_MERCHANT_CHROME = /chatgpt|openai|claude/i

export type AppHeaderMode = 'auto' | 'always' | 'never'

export interface AppHeaderProps {
  /**
   * `'auto'` (default) paints the header only when the host doesn't
   * already render a merchant mark in its chrome (per
   * {@link HOSTS_WITH_MERCHANT_CHROME}). `'always'` forces the
   * header; `'never'` suppresses it. Useful for testing, custom hosts,
   * and integrators who want explicit control.
   */
  mode?: AppHeaderMode
  /** Extra class merged onto the root wrapper. */
  className?: string
  /** Override any of the four `appHeader*` slot classes. */
  classNames?: McpViewClassNames
  /**
   * Explicit merchant to render. When provided, short-circuits the
   * context / cache lookup — useful when the header is mounted
   * outside the `<SolvaPayProvider>` subtree (e.g. `<McpApp>` renders
   * `<AppHeader>` as a chrome row above the conditional provider tree
   * so the merchant mark persists across loading / error / ready
   * states). Pass `null` to explicitly render the `'SolvaPay'` / `'SP'`
   * fallback without consulting the cache.
   */
  merchant?: Merchant | null
  /**
   * Inline content rendered on the right side of the strip (e.g. a
   * close button, status chip). Unused by built-in views; available
   * for integrators.
   */
  children?: React.ReactNode
}

/**
 * Safe merchant read. `<AppHeader>` is rendered by surfaces that live
 * inside `<SolvaPayProvider>` *and* by pre-bootstrap loading / error
 * cards that live outside it. Using `useMerchant()` would throw in
 * the outside case; instead we read the module-level cache the
 * provider's bootstrap seeds (`seedMcpCaches`), gracefully returning
 * `null` when we don't have a context to derive the cache key.
 */
function useMerchantSafe(): Merchant | null {
  const ctx = useContext(SolvaPayContext)
  if (!ctx?._config) return null
  const key = createTransportCacheKey(
    ctx._config,
    ctx._config.api?.getMerchant ?? '/api/merchant',
  )
  return merchantCache.get(key)?.merchant ?? null
}

function getInitials(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return 'SP'
  const parts = trimmed.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) {
    return parts
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('')
  }
  // Single word: prefer a camelCase split (`SolvaPay` → `SP`),
  // falling back to the first two characters uppercased.
  const word = parts[0] ?? ''
  const firstChar = word[0]?.toUpperCase() ?? ''
  const innerUpper = word.slice(1).match(/[A-Z]/)
  if (innerUpper) return firstChar + innerUpper[0]
  return (word.slice(0, 2) || 'SP').toUpperCase()
}

export function AppHeader({
  mode = 'auto',
  className,
  classNames,
  merchant: merchantProp,
  children,
}: AppHeaderProps): React.ReactElement | null {
  const cx = resolveMcpClassNames(classNames)
  // Explicit `merchant` prop wins over context/cache reads; `undefined`
  // means "consult the cache" (default path), while `null` means
  // "force the `SolvaPay`/`SP` fallback".
  const cachedMerchant = useMerchantSafe()
  const merchant = merchantProp !== undefined ? merchantProp : cachedMerchant
  const hostName = useHostName()

  const name = merchant?.displayName ?? 'SolvaPay'
  const iconUrl = merchant?.iconUrl ?? merchant?.logoUrl ?? null

  // Track `<img>` load failures so a broken `iconUrl` / `logoUrl`
  // (typo, 404, CORS refusal) degrades to the initials bubble instead
  // of the browser's broken-image placeholder. `imgLoaded` holds the
  // placeholder in place until the `<img>` actually paints, so we
  // never render a blank 20×20 frame between the initials fallback
  // and the real icon. Both reset when `iconUrl` changes so a new
  // merchant snapshot gets a fresh load attempt — the reset runs in
  // a `useLayoutEffect` so it can *also* promote `imgLoaded` to
  // `true` synchronously when the image is already in the browser's
  // preload cache (see warm-cache comment below), before the browser
  // paints the initials.
  const [imgFailed, setImgFailed] = useState(false)
  const [imgLoaded, setImgLoaded] = useState(false)
  const imgRef = useRef<HTMLImageElement | null>(null)
  // Warm-cache fast path: when `<McpApp>` preloads the merchant icon
  // via `<link rel="preload" as="image">` before `<AppHeader>`
  // mounts, the `<img>` often lands with `complete === true` on its
  // very first commit. Without this hook we'd still wait for the
  // async `onLoad` to fire, which means one paint frame with the
  // initials placeholder visible — "the initials flash".
  // `useLayoutEffect` runs after the DOM mutation but before the
  // browser paints, so flipping `imgLoaded` here is observed in the
  // same commit and the very first visible frame shows the real
  // icon. Cold fetches (`complete === false`) fall through to the
  // normal `onLoad` path and the initials stay in place as the
  // intended placeholder. `naturalHeight > 0` filters out broken
  // images that report `complete === true` without having decoded
  // pixels. Merged with the `iconUrl`-change reset so both updates
  // land in the same commit — an earlier split-effect version let a
  // trailing `useEffect` reset clobber the layout effect's warm-cache
  // promotion on first mount.
  useLayoutEffect(() => {
    const el = imgRef.current
    const cached = el ? el.complete && el.naturalHeight > 0 : false
    // Intentional setState-in-effect: `useLayoutEffect` is the only
    // synchronous-before-paint hook React gives us, and the entire
    // point of this block is to flip `imgLoaded` for the warm-cache
    // fast path *before* the first visible frame so the initials
    // bubble doesn't flash. The cascading-render cost the rule warns
    // about is bounded (one extra commit per `iconUrl` change) and
    // cheaper than the flicker we'd see otherwise.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setImgFailed(false)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setImgLoaded(cached)
  }, [iconUrl])

  if (mode === 'never') return null
  if (mode === 'auto' && hostName && HOSTS_WITH_MERCHANT_CHROME.test(hostName)) {
    return null
  }

  const rootClass = [cx.appHeader, className].filter(Boolean).join(' ')
  // Keep the `<img>` mounted as soon as we have a URL so `onLoad` has
  // a chance to fire, but hide it until the pixels actually land —
  // the initials bubble stays visible as the placeholder under it.
  const hasIconUrl = iconUrl !== null && !imgFailed
  const showInitials = !hasIconUrl || !imgLoaded

  return (
    <header className={rootClass}>
      {hasIconUrl ? (
        <img
          ref={imgRef}
          className={cx.appHeaderIcon}
          src={iconUrl}
          alt=""
          style={imgLoaded ? undefined : { display: 'none' }}
          onLoad={() => setImgLoaded(true)}
          onError={() => setImgFailed(true)}
        />
      ) : null}
      {showInitials ? (
        <span className={cx.appHeaderInitials} aria-hidden="true">
          {getInitials(name)}
        </span>
      ) : null}
      <span className={cx.appHeaderName}>{name}</span>
      {children ? <span className="solvapay-mcp-app-header-slot">{children}</span> : null}
    </header>
  )
}
