import { describe, expect, it } from 'vitest'
import {
  enabledProductionLanguages,
  productionTagsToPush,
  sentinelMoved,
} from './production-tags.js'

describe('sentinelMoved', () => {
  it('is false when HEAD and first-parent share the sentinel', () => {
    expect(sentinelMoved('0.1.0', '0.1.0')).toBe(false)
  })

  it('is true when the sentinel version changed', () => {
    expect(sentinelMoved('0.2.0', '0.1.0')).toBe(true)
  })
})

describe('enabledProductionLanguages', () => {
  it('returns no languages when every RELEASE_PROD_* var is unset or false', () => {
    expect(enabledProductionLanguages({})).toEqual([])
    expect(
      enabledProductionLanguages({
        RELEASE_PROD_PYTHON: 'false',
        RELEASE_PROD_RUBY: '0',
        RELEASE_PROD_GO: '',
        RELEASE_PROD_RUST: 'FALSE',
      }),
    ).toEqual([])
  })

  it('treats true and 1 as on, and only returns RELEASE_TRAIN_LANGUAGES', () => {
    expect(
      enabledProductionLanguages({
        RELEASE_PROD_PYTHON: 'true',
        RELEASE_PROD_RUBY: '1',
        RELEASE_PROD_GO: 'true',
        RELEASE_PROD_RUST: '1',
        RELEASE_PROD_TYPESCRIPT: 'true',
      }),
    ).toEqual(['rust', 'python', 'ruby', 'go'])
  })

  it('keeps train language order when a subset is enabled', () => {
    expect(
      enabledProductionLanguages({
        RELEASE_PROD_GO: 'true',
        RELEASE_PROD_PYTHON: '1',
      }),
    ).toEqual(['python', 'go'])
  })
})

describe('productionTagsToPush', () => {
  it('maps enabled languages to production train tags', () => {
    expect(productionTagsToPush('0.2.0', ['python', 'go'])).toEqual([
      'solvapay-python-v0.2.0',
      'solvapay-go-v0.2.0',
    ])
  })

  it('rejects a non-semver sentinel', () => {
    expect(() => productionTagsToPush('0.2.0-rehearsal.7', ['python'])).toThrow(
      /invalid lockstep semver/,
    )
  })
})
