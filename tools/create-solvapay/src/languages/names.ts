/**
 * Identifier derivation for per-language manifests and source files.
 */

const SNAKE_RE = /[^a-z0-9]+/g

export function snakeCase(value: string): string {
  const fromCamel = value.replace(/([a-z0-9])([A-Z])/g, '$1_$2')
  const cleaned = fromCamel.toLowerCase().replace(SNAKE_RE, '_').replace(/^_+|_+$/g, '')
  return cleaned || 'app'
}

export function pascalCase(value: string): string {
  const parts = snakeCase(value).split('_').filter(Boolean)
  if (parts.length === 0) return 'App'
  return parts.map(part => part.charAt(0).toUpperCase() + part.slice(1)).join('')
}

export function kebabCase(value: string): string {
  return snakeCase(value).replace(/_/g, '-')
}

export type NamePlaceholders = {
  projectName: string
  pythonPackage: string
  rubyModule: string
  goModule: string
  crateName: string
  binName: string
  toolName: string
  toolNameSnake: string
  toolNamePascal: string
}

export type NamePlaceholdersInput = {
  projectName: string
  toolName: string
  goModule?: string
}

export function namePlaceholders(input: NamePlaceholdersInput): NamePlaceholders {
  const projectName = kebabCase(input.projectName)
  return {
    projectName,
    pythonPackage: snakeCase(projectName),
    rubyModule: pascalCase(projectName),
    goModule: input.goModule ?? `github.com/example/${projectName}`,
    crateName: projectName,
    binName: projectName,
    toolName: input.toolName,
    toolNameSnake: snakeCase(input.toolName),
    toolNamePascal: pascalCase(input.toolName),
  }
}

export function defaultGoModule(projectName: string): string {
  return `github.com/example/${kebabCase(projectName)}`
}
