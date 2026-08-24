/**
 * The demos under test, the ports Playwright starts them on, and the env each
 * one needs to talk to the local platform.
 *
 * Ports live in the 3030+ band on purpose: the platform stack occupies
 * 3001–3012 (and the demos' own dev scripts default into that range), so
 * running the suite must never race the stack for a port.
 */

import * as path from 'node:path'
import { EXAMPLES_ROOT, type MerchantEnv } from './env'

export type DemoId =
  | 'shadcn-checkout'
  | 'tailwind-checkout'
  | 'chat-checkout-demo'
  | 'checkout-demo'
  | 'hosted-checkout-demo'

export interface Demo {
  id: DemoId
  /** Directory name under `examples/typescript`. */
  dir: DemoId
  port: number
  /** Dev-server command, run from the demo directory. */
  command: string
  /** Extra env on top of the shared merchant env. */
  extraEnv: (env: MerchantEnv) => Record<string, string>
}

const nextDev = (port: number) => `pnpm exec next dev --webpack --port ${port}`

export const DEMOS: readonly Demo[] = [
  {
    id: 'shadcn-checkout',
    dir: 'shadcn-checkout',
    port: 3030,
    command: nextDev(3030),
    extraEnv: env => ({ NEXT_PUBLIC_SOLVAPAY_PRODUCT_REF: env.productRef }),
  },
  {
    id: 'tailwind-checkout',
    dir: 'tailwind-checkout',
    port: 3031,
    command: nextDev(3031),
    extraEnv: env => ({ NEXT_PUBLIC_SOLVAPAY_PRODUCT_REF: env.productRef }),
  },
  {
    id: 'chat-checkout-demo',
    dir: 'chat-checkout-demo',
    port: 3032,
    command: 'pnpm exec vite --port 3032 --strictPort',
    // The demo's three scenarios each read their own VITE_*_PRODUCT_REF, with
    // SOLVAPAY_PRODUCT_REF as the shared fallback (see its vite.config.ts).
    extraEnv: env => ({ VITE_SUBSCRIPTION_PRODUCT_REF: env.productRef }),
  },
  {
    id: 'checkout-demo',
    dir: 'checkout-demo',
    port: 3033,
    command: nextDev(3033),
    extraEnv: env => ({
      NEXT_PUBLIC_SOLVAPAY_PRODUCT_REF: env.productRef,
      NEXT_PUBLIC_SOLVAPAY_DEMO_AUTH: 'anonymous',
    }),
  },
  {
    id: 'hosted-checkout-demo',
    dir: 'hosted-checkout-demo',
    port: 3034,
    command: nextDev(3034),
    extraEnv: env => ({
      NEXT_PUBLIC_PRODUCT_REF: env.productRef,
      NEXT_PUBLIC_SOLVAPAY_DEMO_AUTH: 'anonymous',
    }),
  },
]

export function findDemo(id: DemoId): Demo {
  const found = DEMOS.find(candidate => candidate.id === id)
  if (!found) {
    throw new Error(`[examples-e2e] No demo registered for "${id}".`)
  }
  return found
}

export function demoDir(demo: Demo): string {
  return path.join(EXAMPLES_ROOT, demo.dir)
}

export function demoBaseUrl(demo: Demo): string {
  return `http://127.0.0.1:${demo.port}`
}

/**
 * Server-side env every demo shares. Injected values are non-empty, so
 * Next/Vite keep them in preference to whatever sits in the demo's own
 * `.env` — the suite never depends on the operator's local files.
 */
export function demoEnv(demo: Demo, env: MerchantEnv): Record<string, string> {
  return {
    SOLVAPAY_API_BASE_URL: env.apiBaseUrl,
    SOLVAPAY_SECRET_KEY: env.secretKey,
    SOLVAPAY_PRODUCT_REF: env.productRef,
    ...demo.extraEnv(env),
  }
}
