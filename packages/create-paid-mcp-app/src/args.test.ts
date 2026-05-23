import { describe, expect, it } from 'vitest'
import { inferMode, parseArgs, sanitizeProjectName, validateToolName } from './args'

describe('parseArgs', () => {
  it('captures the positional project name', () => {
    const result = parseArgs(['my-mcp'])
    expect(result.projectName).toBe('my-mcp')
    expect(result.unknownFlag).toBeUndefined()
  })

  it('parses --openapi <value>', () => {
    const result = parseArgs(['my-mcp', '--openapi', 'https://api.example.com/openapi.json'])
    expect(result.projectName).toBe('my-mcp')
    expect(result.openapi).toBe('https://api.example.com/openapi.json')
  })

  it('parses --no-openapi', () => {
    const result = parseArgs(['my-mcp', '--no-openapi'])
    expect(result.noOpenapi).toBe(true)
  })

  it('parses --tool-name <camel>', () => {
    const result = parseArgs(['--tool-name', 'fetchPet'])
    expect(result.toolName).toBe('fetchPet')
  })

  it('parses -y and --yes interchangeably', () => {
    expect(parseArgs(['-y']).yes).toBe(true)
    expect(parseArgs(['--yes']).yes).toBe(true)
  })

  it('parses --non-interactive (implies --yes)', () => {
    const result = parseArgs(['--non-interactive'])
    expect(result.nonInteractive).toBe(true)
    expect(result.yes).toBe(true)
  })

  it('parses --product <ref>', () => {
    const result = parseArgs(['--product', 'prd_abc'])
    expect(result.product).toBe('prd_abc')
  })

  it('parses --help and -h', () => {
    expect(parseArgs(['--help']).help).toBe(true)
    expect(parseArgs(['-h']).help).toBe(true)
  })

  it('ignores `--` pass-through separator', () => {
    const result = parseArgs(['my-mcp', '--', '--yes'])
    expect(result.projectName).toBe('my-mcp')
    expect(result.yes).toBe(true)
  })

  it('rejects unknown flags', () => {
    const result = parseArgs(['--bogus'])
    expect(result.unknownFlag).toBe('--bogus')
  })

  it('flags missing value for value-flags', () => {
    const result = parseArgs(['--openapi'])
    expect(result.unknownFlag).toContain('--openapi requires a value')
  })

  it('parses a realistic mix', () => {
    const result = parseArgs([
      'my-mcp',
      '--openapi',
      './openapi.json',
      '--product',
      'prd_test',
      '-y',
    ])
    expect(result).toMatchObject({
      projectName: 'my-mcp',
      openapi: './openapi.json',
      product: 'prd_test',
      yes: true,
    })
  })
})

describe('inferMode', () => {
  it('returns from-openapi when --openapi is set', () => {
    expect(inferMode(parseArgs(['my-mcp', '--openapi', './s.json']))).toBe('from-openapi')
  })

  it('returns from-scratch when --no-openapi is set', () => {
    expect(inferMode(parseArgs(['my-mcp', '--no-openapi']))).toBe('from-scratch')
  })

  it('returns null when neither is set (CLI must prompt)', () => {
    expect(inferMode(parseArgs(['my-mcp']))).toBeNull()
  })
})

describe('sanitizeProjectName', () => {
  it('accepts a clean kebab-case name', () => {
    expect(sanitizeProjectName('my-mcp')).toEqual({ ok: true, name: 'my-mcp' })
  })

  it('lowercases and replaces spaces', () => {
    expect(sanitizeProjectName('My App')).toEqual({ ok: true, name: 'my-app' })
  })

  it('rejects an empty string', () => {
    const result = sanitizeProjectName('')
    expect(result.ok).toBe(false)
  })

  it('rejects names that resolve to only punctuation', () => {
    const result = sanitizeProjectName('___')
    expect(result.ok).toBe(false)
  })
})

describe('validateToolName', () => {
  it('accepts a clean camelCase name', () => {
    expect(validateToolName('fetchPet')).toEqual({ ok: true, name: 'fetchPet' })
  })

  it('accepts a single lowercase word', () => {
    expect(validateToolName('hello')).toEqual({ ok: true, name: 'hello' })
  })

  it('rejects PascalCase', () => {
    expect(validateToolName('FetchPet').ok).toBe(false)
  })

  it('rejects kebab-case', () => {
    expect(validateToolName('fetch-pet').ok).toBe(false)
  })

  it('rejects empty', () => {
    expect(validateToolName('').ok).toBe(false)
  })
})
