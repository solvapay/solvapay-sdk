import { describe, expect, it } from 'vitest'
import { assertLanguageSupported, assertOpenapiLanguage } from './matrix'

describe('assertLanguageSupported', () => {
  it('allows mcp in every official language', () => {
    expect(() => assertLanguageSupported('mcp', 'python')).not.toThrow()
    expect(() => assertLanguageSupported('mcp', 'rust')).not.toThrow()
  })

  it('rejects next-auth0 in a non-TypeScript language', () => {
    expect(() => assertLanguageSupported('next-auth0', 'go')).toThrow(/does not support/)
  })
})

describe('assertOpenapiLanguage', () => {
  it('rejects --openapi with a non-TypeScript language', () => {
    expect(() => assertOpenapiLanguage('go')).toThrow(/TypeScript-only/)
  })

  it('allows TypeScript', () => {
    expect(() => assertOpenapiLanguage('ts')).not.toThrow()
  })
})
