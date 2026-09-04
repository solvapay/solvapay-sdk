import { describe, expect, it } from 'vitest'
import { namePlaceholders, pascalCase, snakeCase } from './names'

describe('namePlaceholders', () => {
  it('derives language identifiers from my-app / helloTool', () => {
    expect(namePlaceholders({ projectName: 'my-app', toolName: 'helloTool' })).toEqual({
      projectName: 'my-app',
      pythonPackage: 'my_app',
      rubyModule: 'MyApp',
      goModule: 'github.com/example/my-app',
      crateName: 'my-app',
      binName: 'my-app',
      toolName: 'helloTool',
      toolNameSnake: 'hello_tool',
      toolNamePascal: 'HelloTool',
    })
  })

  it('honors an explicit Go module path', () => {
    expect(
      namePlaceholders({
        projectName: 'weather',
        toolName: 'hello',
        goModule: 'github.com/acme/weather',
      }).goModule,
    ).toBe('github.com/acme/weather')
  })
})

describe('snakeCase / pascalCase', () => {
  it('converts camelCase tool names', () => {
    expect(snakeCase('fetchPet')).toBe('fetch_pet')
    expect(pascalCase('fetchPet')).toBe('FetchPet')
  })
})
