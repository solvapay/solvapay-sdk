/**
 * Node-only webhook loader shims over {@link ./native}.
 *
 * Kept as a stable import path for Step 37 call sites (`index.ts`). Prefer
 * `native.ts` for new surfaces. Never import from `edge.ts`.
 */

import {
  loadNativeBinding,
  resetNativeCache,
  setNativeBindingForTests,
  verifyWebhookNative,
  type NativeBinding,
} from './native'

/** @deprecated Prefer {@link resetNativeCache} from `./native`. */
export function resetWebhookBindingCache(): void {
  resetNativeCache()
}

/** @deprecated Prefer {@link setNativeBindingForTests} from `./native`. */
export function setWebhookBindingForTests(binding: NativeBinding | null): void {
  setNativeBindingForTests(binding)
}

export { loadNativeBinding, verifyWebhookNative }
