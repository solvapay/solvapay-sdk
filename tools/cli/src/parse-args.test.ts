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

  it('flags --help and -h without running the flow', () => {
    expect(parseInitArgs(['--help'])).toMatchObject({ help: true })
    expect(parseInitArgs(['-h'])).toMatchObject({ help: true })
    expect(parseInitArgs([])).toMatchObject({ help: false })
  })

  it('rejects an unknown flag instead of silently ignoring it', () => {
    expect(() => parseInitArgs(['--bogus'])).toThrow(/Unknown init flag: --bogus/)
  })
})

describe('parseDoctorArgs', () => {
  it('parses --api-base', () => {
    expect(parseDoctorArgs(['--api-base', 'http://localhost:3010'])).toEqual({
      help: false,
      dev: false,
      apiBaseUrl: 'http://localhost:3010',
    })
  })

  it('rejects --api-base without a value', () => {
    expect(() => parseDoctorArgs(['--api-base'])).toThrow(/--api-base requires a URL/)
  })

  it('flags --help and -h', () => {
    expect(parseDoctorArgs(['--help'])).toMatchObject({ help: true })
    expect(parseDoctorArgs(['-h'])).toMatchObject({ help: true })
  })
})
