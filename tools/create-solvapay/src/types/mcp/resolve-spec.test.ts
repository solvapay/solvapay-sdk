import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveSpecLocation } from './index'

describe('resolveSpecLocation', () => {
  it('keeps http(s) URLs unchanged', () => {
    expect(resolveSpecLocation('https://petstore.swagger.io/v2/swagger.json')).toBe(
      'https://petstore.swagger.io/v2/swagger.json',
    )
    expect(resolveSpecLocation('http://127.0.0.1:8080/openapi.yaml')).toBe(
      'http://127.0.0.1:8080/openapi.yaml',
    )
  })

  it('resolves relative local paths against process.cwd()', () => {
    expect(resolveSpecLocation('./petstore.json')).toBe(
      path.resolve(process.cwd(), './petstore.json'),
    )
  })
})
