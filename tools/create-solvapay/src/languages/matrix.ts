import type { ScaffoldLanguage } from '@solvapay/init'
import { LANGUAGE_LABELS, PREVIEW_LANGUAGES } from '@solvapay/init'

export const TYPE_LANGUAGES: Record<string, readonly ScaffoldLanguage[]> = {
  mcp: ['ts', 'python', 'ruby', 'go', 'rust'],
  'next-auth0': ['ts'],
}

export function supportedLanguagesForType(typeId: string): readonly ScaffoldLanguage[] {
  return TYPE_LANGUAGES[typeId] ?? []
}

export function assertLanguageSupported(typeId: string, language: ScaffoldLanguage): void {
  const supported = supportedLanguagesForType(typeId)
  if (supported.includes(language)) return
  const valid = supported.length > 0 ? supported.join(', ') : 'none'
  throw new Error(
    `--type ${typeId} does not support --language ${language} (${LANGUAGE_LABELS[language]}). ` +
      `Supported: ${valid}.`,
  )
}

export function assertOpenapiLanguage(language: ScaffoldLanguage): void {
  if (language === 'ts') return
  throw new Error(
    'OpenAPI codegen is TypeScript-only for now. Use --language ts, or omit --openapi / pass --no-openapi.',
  )
}

export function formatLanguageList(languages: readonly ScaffoldLanguage[]): string {
  return languages.map(id => (PREVIEW_LANGUAGES.includes(id) ? `${id} (preview)` : id)).join(', ')
}
