/**
 * Node-only webhook loader shims over {@link ./native}.
 *
 * Kept as a stable import path for Step 37 call sites (`index.ts`). Prefer
 * `native.ts` for new surfaces. Never import from `edge.ts`.
 */

import {
  loadNativeBinding,
  resetNativeCache,
  resolveImpl,
  setNativeBindingForTests,
  verifyWebhookNative,
  type NativeBinding,
  type SolvaPayImpl,
} from './native'

export type WebhookImpl = SolvaPayImpl

/** @deprecated Prefer {@link resetNativeCache} from `./native`. */
export function resetWebhookBindingCache(): void {
  resetNativeCache()
}

/** @deprecated Prefer {@link setNativeBindingForTests} from `./native`. */
export function setWebhookBindingForTests(binding: NativeBinding | null): void {
  setNativeBindingForTests(binding)
}

/**
 * Selects the webhook verification implementation.
 *
 * @see {@link resolveImpl}
 */
export function resolveWebhookImpl(): WebhookImpl {
  return resolveImpl('webhook')
}

export { loadNativeBinding, verifyWebhookNative }
