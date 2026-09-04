import readline from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { LANGUAGE_LABELS, PREVIEW_LANGUAGES, type ScaffoldLanguage } from './ids'

export type ChoiceEntry<T extends string> = {
  id: T
  label: string
}

/**
 * Numbered readline picker. Same style as the product picker and
 * create-solvapay type prompt — type a number, no arrow keys.
 */
export async function promptChoice<T extends string>(
  title: string,
  entries: ReadonlyArray<ChoiceEntry<T>>,
): Promise<T> {
  if (!stdin.isTTY || !stdout.isTTY) {
    throw new Error(`${title} requires a TTY, or pass an explicit flag.`)
  }
  if (entries.length === 0) {
    throw new Error(`${title}: no choices available.`)
  }

  process.stdout.write(`${title}\n`)
  entries.forEach((entry, index) => {
    process.stdout.write(`  ${index + 1}) ${entry.label}\n`)
  })

  const rl = readline.createInterface({ input: stdin, output: stdout })
  try {
    const answer = (await rl.question('> ')).trim()
    const index = Number.parseInt(answer, 10)
    if (!Number.isFinite(index) || index < 1 || index > entries.length) {
      throw new Error(`Invalid selection: ${answer}`)
    }
    const selected = entries[index - 1]
    if (!selected) {
      throw new Error(`Invalid selection: ${answer}`)
    }
    return selected.id
  } finally {
    rl.close()
  }
}

export function languageChoiceEntries(
  languages: readonly ScaffoldLanguage[],
): Array<ChoiceEntry<ScaffoldLanguage>> {
  return languages.map(id => ({
    id,
    label: PREVIEW_LANGUAGES.includes(id)
      ? `${LANGUAGE_LABELS[id]} (preview)`
      : LANGUAGE_LABELS[id],
  }))
}

export async function promptLanguage(
  languages: readonly ScaffoldLanguage[],
): Promise<ScaffoldLanguage> {
  return promptChoice('Which language?', languageChoiceEntries(languages))
}
