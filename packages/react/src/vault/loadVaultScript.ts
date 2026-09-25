/**
 * Loads the vault's capture script from its CDN.
 *
 * The script cannot be bundled or served from our own origin: the vault serves
 * the sensitive iframes itself, and that is the whole point of the surface.
 * The only thing we control is which version we pin and that the browser
 * verifies it.
 */

import { CaptureError } from './types'

/** Minimal structural shape of the vault global. Kept to what we actually call. */
export interface VaultFieldHandle {
  on(event: string, handler: (payload: unknown) => void): void
  unmount(): void
  promise?: Promise<unknown>
}

export interface VaultFormHandle {
  field(selector: string, options: Record<string, unknown>): VaultFieldHandle
  createCard(
    payload: { auth: string; data?: Record<string, unknown> },
    onSuccess: (card: unknown) => void,
    onError: (error: unknown) => void,
  ): void
  unmount(): void
  on?(event: string, handler: () => void): void
  state?: Record<string, unknown>
}

export interface VaultCollectGlobal {
  create(
    tenantId: string,
    environment: string,
    onStateChange: (state: Record<string, unknown>) => void,
  ): VaultFormHandle
}

export interface VaultScriptConfig {
  /**
   * Pinned version. Do not float it: the capture surface is the one place
   * where a silent upstream change is a payment-page script-integrity problem
   * rather than a cosmetic one.
   *
   * The vault's own documentation is inconsistent about the current version
   * across pages, so this is deliberately a required decision rather than a
   * default. Tracked in ticket 26d.
   */
  version: string
  /**
   * Subresource integrity hash for this exact version, from the vault.
   *
   * Optional only so a sandbox spike is not blocked on obtaining it. Shipping
   * to Live without it is not acceptable, and `assertIntegrityForLive` below
   * exists to make that a loud failure rather than a quiet omission.
   */
  integrity?: string
  /** Override for tests. Production should never set this. */
  host?: string
}

const DEFAULT_HOST = 'https://js.verygoodvault.com'
const GLOBAL_KEY = 'VGSCollect'
const LOAD_TIMEOUT_MS = 15000

type LoaderWindow = Window & { [GLOBAL_KEY]?: VaultCollectGlobal }

let inFlight: Promise<VaultCollectGlobal> | null = null

function scriptUrl(config: VaultScriptConfig): string {
  const host = config.host ?? DEFAULT_HOST
  return `${host}/vgs-collect/${config.version}/vgs-collect.js`
}

/**
 * Resolves with the vault global, loading the script once per page.
 *
 * Concurrent callers share one promise, and a successful load is cached, so
 * mounting several forms does not mean several script tags.
 */
export function loadVaultScript(config: VaultScriptConfig): Promise<VaultCollectGlobal> {
  if (typeof window === 'undefined') {
    return Promise.reject(
      new CaptureError('script_load_failed', 'The capture surface requires a browser.'),
    )
  }

  const existing = (window as LoaderWindow)[GLOBAL_KEY]
  if (existing) return Promise.resolve(existing)
  if (inFlight) return inFlight

  const url = scriptUrl(config)

  inFlight = new Promise<VaultCollectGlobal>((resolve, reject) => {
    const fail = (reason: string) => {
      inFlight = null
      // Drop the tag as well. Leaving a tag whose load/error already fired
      // meant every later attempt attached listeners to a dead element, set no
      // src, and sat through the full timeout before reporting a misleading
      // "did not load in time" instead of the accurate blocked-host message.
      try {
        document.querySelector(`script[data-solvapay-vault-script="${config.version}"]`)?.remove()
      } catch {
        // Nothing to clean up.
      }
      reject(new CaptureError('script_load_failed', reason))
    }

    let settled = false
    const timer = window.setTimeout(() => {
      if (settled) return
      settled = true
      fail(
        `The capture script did not load within ${LOAD_TIMEOUT_MS}ms. ` +
          'The usual cause is a Content-Security-Policy that does not allow the vault ' +
          'script and frame hosts. See the allowlist in ticket 26.',
      )
    }, LOAD_TIMEOUT_MS)

    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      fn()
    }

    // Reuse a tag another instance already added, rather than adding a second.
    const selector = `script[data-solvapay-vault-script="${config.version}"]`
    const existingTag = document.querySelector<HTMLScriptElement>(selector)
    const script = existingTag ?? document.createElement('script')

    const onLoad = () => {
      const global = (window as LoaderWindow)[GLOBAL_KEY]
      if (!global) {
        settle(() =>
          fail('The capture script loaded but did not register itself. Check the pinned version.'),
        )
        return
      }
      settle(() => {
        inFlight = null
        resolve(global)
      })
    }

    script.addEventListener('load', onLoad)
    script.addEventListener('error', () =>
      settle(() =>
        fail(
          `The capture script at ${url} failed to load. This is usually a blocked host ` +
            'in Content-Security-Policy, a failed integrity check, or no network.',
        ),
      ),
    )

    if (!existingTag) {
      script.src = url
      script.async = true
      script.dataset.solvapayVaultScript = config.version
      if (config.integrity) {
        script.integrity = config.integrity
        script.crossOrigin = 'anonymous'
      }
      document.head.appendChild(script)
    } else if ((window as LoaderWindow)[GLOBAL_KEY]) {
      onLoad()
    }
  })

  return inFlight
}

/**
 * Throws when a Live capture surface is configured without an integrity hash.
 *
 * Call this at the point of configuration rather than at first render, so the
 * failure happens in a deploy check and not in front of a cardholder.
 */
export function assertIntegrityForLive(config: VaultScriptConfig, environment: string): void {
  if (environment === 'live' && !config.integrity) {
    throw new CaptureError(
      'script_load_failed',
      'A Live capture surface must pin a subresource integrity hash for the vault script. ' +
        'Obtain it from the vault for the exact pinned version and supply it as `integrity`.',
    )
  }
}

/** Test seam. Resets the module-level cache between cases. */
export function resetVaultScriptLoaderForTests(): void {
  inFlight = null
  if (typeof window !== 'undefined') {
    delete (window as LoaderWindow)[GLOBAL_KEY]
  }
}
