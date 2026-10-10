import { describe, expect, it } from 'vitest'
import { estimateCall, OUTPUT_TOKENS_CAP, priceOf } from '../agent-layer/pricing'

describe('priceOf', () => {
  it('finds a model by prefix, the most specific entry first', () => {
    expect(priceOf('claude-opus-5-5')).toEqual({ input: 4, output: 20 })
    expect(priceOf('claude-opus-5')).toEqual({ input: 5, output: 25 })
    expect(priceOf('claude-opus-4-6')).toEqual({ input: 5, output: 25 })
    expect(priceOf('claude-opus-4-1-20250805')).toEqual({ input: 15, output: 75 })
    expect(priceOf('claude-sonnet-4-5-20250929')).toEqual({ input: 3, output: 15 })
    expect(priceOf('claude-haiku-5-5')).toEqual({ input: 0.1, output: 0.5 })
  })

  it('prices an unknown model at the dearest rate', () => {
    expect(priceOf('mystery-model')).toEqual({ input: 15, output: 75 })
  })
})

describe('estimateCall', () => {
  it('prices body bytes ÷ 4 as input and max_tokens as output, exactly', () => {
    // Sonnet 4.6: 1,000 tokens in at 3 USD/MTok = 0.003; 1,000 out at 15 = 0.015.
    expect(
      estimateCall({ model: 'claude-sonnet-4-6', bodyBytes: 4_000, maxTokens: 1_000 }),
    ).toEqual({
      model: 'claude-sonnet-4-6',
      inputTokens: 1_000,
      outputTokens: 1_000,
      estimateUsd: '0.018',
    })
  })

  it(`caps output at ${OUTPUT_TOKENS_CAP} tokens, and takes the cap when max_tokens is absent`, () => {
    const big = estimateCall({ model: 'claude-sonnet-4-6', bodyBytes: 0, maxTokens: 32_000 })
    const none = estimateCall({ model: 'claude-sonnet-4-6', bodyBytes: 0 })
    expect(big.outputTokens).toBe(OUTPUT_TOKENS_CAP)
    expect(none.outputTokens).toBe(OUTPUT_TOKENS_CAP)
    expect(big.estimateUsd).toBe('0.03')
  })

  it('keeps sub-cent estimates exact to 1e-8 USD', () => {
    // Haiku 5.5: 3 tokens in at 0.10 = 0.0000003; 6 out at 0.50 = 0.000003.
    expect(
      estimateCall({ model: 'claude-haiku-5-5', bodyBytes: 10, maxTokens: 6 }).estimateUsd,
    ).toBe('0.0000033')
  })

  it('estimates a large Claude Code turn on Opus 4.6', () => {
    // 400 kB body ≈ 100,000 tokens × 5 = 0.5; 2,000 out × 25 = 0.05.
    expect(
      estimateCall({ model: 'claude-opus-4-6', bodyBytes: 400_000, maxTokens: 64_000 }).estimateUsd,
    ).toBe('0.55')
  })
})
