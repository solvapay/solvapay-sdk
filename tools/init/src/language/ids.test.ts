import { describe, expect, it } from 'vitest'
import { parseScaffoldLanguage } from './ids'

describe('parseScaffoldLanguage', () => {
  it('accepts canonical ids', () => {
    expect(parseScaffoldLanguage('ts')).toEqual({ ok: true, language: 'ts' })
    expect(parseScaffoldLanguage('python')).toEqual({ ok: true, language: 'python' })
    expect(parseScaffoldLanguage('ruby')).toEqual({ ok: true, language: 'ruby' })
    expect(parseScaffoldLanguage('go')).toEqual({ ok: true, language: 'go' })
    expect(parseScaffoldLanguage('rust')).toEqual({ ok: true, language: 'rust' })
  })

  it('accepts common aliases', () => {
    expect(parseScaffoldLanguage('TypeScript')).toEqual({ ok: true, language: 'ts' })
    expect(parseScaffoldLanguage('py')).toEqual({ ok: true, language: 'python' })
    expect(parseScaffoldLanguage('golang')).toEqual({ ok: true, language: 'go' })
  })

  it('rejects unknown values with the valid list', () => {
    const result = parseScaffoldLanguage('cobol')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toContain('cobol')
      expect(result.reason).toContain('ts')
    }
  })
})
