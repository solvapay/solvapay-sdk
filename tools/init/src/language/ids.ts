export const SCAFFOLD_LANGUAGES = ['ts', 'python', 'ruby', 'go', 'rust'] as const

export type ScaffoldLanguage = (typeof SCAFFOLD_LANGUAGES)[number]

export const LANGUAGE_LABELS: Record<ScaffoldLanguage, string> = {
  ts: 'TypeScript',
  python: 'Python',
  ruby: 'Ruby',
  go: 'Go',
  rust: 'Rust',
}

/** Train languages that are not yet announced as stable in the scaffolder. */
export const PREVIEW_LANGUAGES: readonly ScaffoldLanguage[] = ['python', 'ruby', 'go', 'rust']

export const LANGUAGE_MANIFESTS: Record<ScaffoldLanguage, string> = {
  ts: 'package.json',
  python: 'pyproject.toml',
  ruby: 'Gemfile',
  go: 'go.mod',
  rust: 'Cargo.toml',
}

export function isScaffoldLanguage(value: string): value is ScaffoldLanguage {
  return (SCAFFOLD_LANGUAGES as readonly string[]).includes(value)
}

export function parseScaffoldLanguage(
  value: string,
): { ok: true; language: ScaffoldLanguage } | { ok: false; reason: string } {
  const trimmed = value.trim().toLowerCase()
  const aliases: Record<string, ScaffoldLanguage> = {
    ts: 'ts',
    typescript: 'ts',
    js: 'ts',
    javascript: 'ts',
    python: 'python',
    py: 'python',
    ruby: 'ruby',
    rb: 'ruby',
    go: 'go',
    golang: 'go',
    rust: 'rust',
    rs: 'rust',
  }
  const language = aliases[trimmed]
  if (!language) {
    return {
      ok: false,
      reason: `Unknown language: ${value}. Valid: ${SCAFFOLD_LANGUAGES.join(', ')}`,
    }
  }
  return { ok: true, language }
}
