import { describe, expect, it } from 'vitest'
import { parseDoctorArgs, parseInitArgs } from './parse-args'

describe('parseInitArgs', () => {
  it('parses --language and -l', () => {
    expect(parseInitArgs(['--language', 'python'])).toMatchObject({ language: 'python' })
    expect(parseInitArgs(['-l', 'go'])).toMatchObject({ language: 'go' })
  })

  it('rejects an unknown language', () => {
    expect(() => parseInitArgs(['--language', 'cobol'])).toThrow(/Unknown language/)
  })

  it('parses --api-base', () => {
    expect(parseInitArgs(['--api-base', 'http://localhost:3010'])).toMatchObject({
      apiBaseUrl: 'http://localhost:3010',
    })
  })

  it('rejects --api-base without a value', () => {
    expect(() => parseInitArgs(['--api-base'])).toThrow(/--api-base requires a URL/)
  })
})

describe('parseDoctorArgs', () => {
  it('parses --api-base', () => {
    expect(parseDoctorArgs(['--api-base', 'http://localhost:3010'])).toEqual({
      dev: false,
      apiBaseUrl: 'http://localhost:3010',
    })
  })

  it('rejects --api-base without a value', () => {
    expect(() => parseDoctorArgs(['--api-base'])).toThrow(/--api-base requires a URL/)
  })
})
