// The estimate a paid call is decided on before Opper is called (build plan
// §7e, decision 3). Only the merchant knows its prices, so the clone estimates:
// input tokens ≈ body bytes ÷ 4, output = min(max_tokens, 2,000), priced from
// the table below. The tier groups models by family for the spend policy's
// allowed tiers: Haiku S, Sonnet M, Opus L, anything else XL.
//
// [Assumption] Opper passes Anthropic's list prices through (USD per million
// tokens, first-party rates as of Oct 2026). Calibrated against the reported
// cost in the live run (5.7).

export type ModelTier = 'S' | 'M' | 'L' | 'XL'

/** USD per million tokens. */
interface Price {
  input: number
  output: number
}

/** Matched by prefix, first hit wins, so a dated id (`claude-haiku-4-5-20251001`) finds its model. */
const PRICES: readonly [prefix: string, price: Price][] = [
  ['claude-haiku-5-5', { input: 0.1, output: 0.5 }],
  ['claude-haiku-4-5', { input: 1, output: 5 }],
  ['claude-sonnet-5-5', { input: 2, output: 10 }],
  ['claude-sonnet-5', { input: 2, output: 10 }],
  ['claude-sonnet-4', { input: 3, output: 15 }],
  ['claude-opus-5-5', { input: 4, output: 20 }],
  ['claude-opus-5', { input: 5, output: 25 }],
  ['claude-opus-4-8', { input: 5, output: 25 }],
  ['claude-opus-4-7', { input: 5, output: 25 }],
  ['claude-opus-4-6', { input: 5, output: 25 }],
  ['claude-opus-4-5', { input: 5, output: 25 }],
  ['claude-opus-4', { input: 15, output: 75 }],
  ['claude-fable-5', { input: 10, output: 50 }],
]

/** An unknown model is priced at the dearest rate in the table, so the estimate never runs low. */
const UNKNOWN_PRICE: Price = { input: 15, output: 75 }

const BYTES_PER_TOKEN = 4
/** Claude Code asks for a large max_tokens on every turn; few turns write that much. */
export const OUTPUT_TOKENS_CAP = 2_000

export interface Estimate {
  model: string
  tier: ModelTier
  inputTokens: number
  outputTokens: number
  /** USD decimal string with up to 8 places. */
  estimateUsd: string
}

export function tierOf(model: string): ModelTier {
  const name = normalise(model)
  if (name.includes('haiku')) return 'S'
  if (name.includes('sonnet')) return 'M'
  if (name.includes('opus')) return 'L'
  return 'XL'
}

export function priceOf(model: string): Price {
  const name = normalise(model)
  return PRICES.find(([prefix]) => name.startsWith(prefix))?.[1] ?? UNKNOWN_PRICE
}

export function estimateCall(input: {
  model: string
  bodyBytes: number
  maxTokens?: number
}): Estimate {
  const price = priceOf(input.model)
  const inputTokens = Math.ceil(input.bodyBytes / BYTES_PER_TOKEN)
  const outputTokens = Math.min(input.maxTokens ?? OUTPUT_TOKENS_CAP, OUTPUT_TOKENS_CAP)
  // Integers of 1e-8 USD: a price per million tokens × 100 is the price of one token.
  const units =
    inputTokens * Math.round(price.input * 100) + outputTokens * Math.round(price.output * 100)
  return {
    model: input.model,
    tier: tierOf(input.model),
    inputTokens,
    outputTokens,
    estimateUsd: unitsToUsd(units),
  }
}

/** `anthropic/claude-sonnet-4-6` and `Claude-Sonnet-4-6` are the same model. */
function normalise(model: string): string {
  const lower = model.trim().toLowerCase()
  return lower.slice(lower.lastIndexOf('/') + 1)
}

function unitsToUsd(units: number): string {
  const whole = Math.floor(units / 100_000_000)
  const fraction = String(units % 100_000_000)
    .padStart(8, '0')
    .replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : String(whole)
}
