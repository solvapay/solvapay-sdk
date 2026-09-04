import { access } from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import {
  LANGUAGE_MANIFESTS,
  SCAFFOLD_LANGUAGES,
  type ScaffoldLanguage,
} from './ids'

export type LanguageDetection =
  | { status: 'detected'; language: ScaffoldLanguage }
  | { status: 'ambiguous'; candidates: ScaffoldLanguage[] }
  | { status: 'none' }

const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await access(filePath, constants.F_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Detect the project language from manifests in `cwd` only (no parent walk).
 * Multiple manifests mean the filesystem is ambiguous — the caller must prompt
 * or take `--language`.
 */
export async function detectProjectLanguage(cwd: string): Promise<LanguageDetection> {
  const found: ScaffoldLanguage[] = []
  for (const language of SCAFFOLD_LANGUAGES) {
    if (await fileExists(path.join(cwd, LANGUAGE_MANIFESTS[language]))) {
      found.push(language)
    }
  }
  if (found.length === 0) return { status: 'none' }
  if (found.length === 1) {
    const language = found[0]
    if (language === undefined) return { status: 'none' }
    return { status: 'detected', language }
  }
  return { status: 'ambiguous', candidates: found }
}
