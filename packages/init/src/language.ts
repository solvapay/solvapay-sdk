/**
 * Which language a project is in, and which tool manages its packages.
 *
 * `solvapay init` and `create-solvapay` run this before touching the folder,
 * so a Python or Go project never gets a `package.json` or npm packages.
 * The markers are read from the folder itself, not its parents:
 *
 * | Found                                         | Language | Manager            |
 * | --------------------------------------------- | -------- | ------------------ |
 * | `go.mod`                                      | Go       | `go`               |
 * | `uv.lock`                                     | Python   | uv                 |
 * | `poetry.lock`, or `[tool.poetry]` in pyproject | Python   | Poetry             |
 * | any other `pyproject.toml`, `requirements.txt` | Python   | pip                |
 * | `package.json`                                | TS       | npm, pnpm or yarn  |
 *
 * Markers for two languages, or none, need `--language` (or an answer at a
 * terminal). With no terminal the run fails rather than guess.
 */
import { access, readFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import readline from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { detectPackageManager, ensureNodeProject, type PackageManager } from './project'

export const LANGUAGES = ['ts', 'python', 'go'] as const
export type Language = (typeof LANGUAGES)[number]
export type PythonManager = 'uv' | 'poetry' | 'pip'

export const LANGUAGE_LABELS: Record<Language, string> = {
  ts: 'TypeScript',
  python: 'Python',
  go: 'Go',
}

export type DetectedProject =
  | { language: 'ts'; manager: PackageManager; createdPackageJson: boolean }
  | { language: 'python'; manager: PythonManager }
  | { language: 'go'; manager: 'go' }

export type DetectProjectOptions = {
  /** `--language`: use this language, even when other markers are present. */
  language?: Language
  /**
   * Whether a person can answer a question. False with `--yes` or without a
   * terminal; the run then fails where it would have asked.
   */
  interactive: boolean
  /** Picks one of `choices`; injectable for tests. Defaults to a terminal prompt. */
  ask?: (question: string, choices: readonly Language[]) => Promise<Language>
}

/** `--language` value → Language. Anything else throws. */
export const parseLanguage = (value: string): Language => {
  const normalised = value.trim().toLowerCase()
  if (normalised === 'typescript' || normalised === 'js' || normalised === 'javascript') return 'ts'
  if ((LANGUAGES as readonly string[]).includes(normalised)) return normalised as Language
  throw new Error(`Unknown --language "${value}". Use one of: ${LANGUAGES.join(', ')}.`)
}

const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await access(filePath, constants.F_OK)
    return true
  } catch {
    return false
  }
}

const MARKER_FILES: Record<Language, string[]> = {
  go: ['go.mod'],
  python: ['pyproject.toml', 'requirements.txt', 'uv.lock', 'poetry.lock'],
  ts: ['package.json'],
}

/** The languages whose marker files are in `cwd`, with the files found. */
export const findLanguageMarkers = async (
  cwd: string,
): Promise<Array<{ language: Language; files: string[] }>> => {
  const found: Array<{ language: Language; files: string[] }> = []
  for (const language of LANGUAGES) {
    const files: string[] = []
    for (const file of MARKER_FILES[language]) {
      if (await fileExists(path.join(cwd, file))) files.push(file)
    }
    if (files.length > 0) found.push({ language, files })
  }
  return found
}

export const detectPythonManager = async (cwd: string): Promise<PythonManager> => {
  if (await fileExists(path.join(cwd, 'uv.lock'))) return 'uv'
  if (await fileExists(path.join(cwd, 'poetry.lock'))) return 'poetry'
  const pyproject = path.join(cwd, 'pyproject.toml')
  if (await fileExists(pyproject)) {
    const text = await readFile(pyproject, 'utf8')
    if (/^\[tool\.poetry\]/m.test(text)) return 'poetry'
  }
  return 'pip'
}

const askLanguage = async (question: string, choices: readonly Language[]): Promise<Language> => {
  const rl = readline.createInterface({ input: stdin, output: stdout })
  try {
    stdout.write(`${question}\n`)
    choices.forEach((choice, i) => stdout.write(`  ${i + 1}) ${LANGUAGE_LABELS[choice]}\n`))
    const answer = (await rl.question('> ')).trim()
    const index = Number.parseInt(answer, 10)
    if (Number.isFinite(index) && index >= 1 && index <= choices.length) return choices[index - 1]
    return parseLanguage(answer)
  } finally {
    rl.close()
  }
}

const describeMarkers = (found: Array<{ files: string[] }>): string =>
  found.flatMap(entry => entry.files).join(' and ')

const missingProjectError = (language: 'python' | 'go', cwd: string): Error =>
  language === 'python'
    ? new Error(
        `No pyproject.toml or requirements.txt in ${cwd}. Create the Python project first ` +
          '(`uv init && uv lock`, or `poetry init`), then run init again.',
      )
    : new Error(
        `No go.mod in ${cwd}. Create the Go module first (\`go mod init <module path>\`), then run init again.`,
      )

const projectFor = async (
  language: Language,
  cwd: string,
  present: boolean,
): Promise<DetectedProject> => {
  if (language === 'go') {
    if (!present) throw missingProjectError('go', cwd)
    return { language: 'go', manager: 'go' }
  }
  if (language === 'python') {
    if (!present) throw missingProjectError('python', cwd)
    return { language: 'python', manager: await detectPythonManager(cwd) }
  }
  let createdPackageJson = false
  if (!present) {
    const created = await ensureNodeProject({ cwd, autoCreate: true })
    createdPackageJson = created.action === 'created'
  }
  return { language: 'ts', manager: await detectPackageManager(cwd), createdPackageJson }
}

/**
 * The project in `cwd`. Creates a `package.json` only when the language is
 * TypeScript by `--language ts` or by the person's answer, never by default.
 */
export const detectProject = async (
  cwd: string,
  options: DetectProjectOptions,
): Promise<DetectedProject> => {
  const found = await findLanguageMarkers(cwd)
  const has = (language: Language) => found.some(entry => entry.language === language)
  const ask = options.ask ?? askLanguage

  if (options.language) return projectFor(options.language, cwd, has(options.language))

  if (found.length === 1) return projectFor(found[0].language, cwd, true)

  if (found.length > 1) {
    const choices = found.map(entry => entry.language)
    if (!options.interactive) {
      throw new Error(
        `Found ${describeMarkers(found)} in ${cwd}. Pass --language ${choices.join('|')}.`,
      )
    }
    const language = await ask(
      `Found ${describeMarkers(found)}. Which language is this SolvaPay integration in?`,
      choices,
    )
    return projectFor(language, cwd, true)
  }

  if (!options.interactive) {
    throw new Error(
      `No package.json, pyproject.toml, requirements.txt or go.mod in ${cwd}. ` +
        'Pass --language ts to create a package.json here, or create the Python or Go project first.',
    )
  }
  const language = await ask(
    'No project files found. Which language is this project in?',
    LANGUAGES,
  )
  return projectFor(language, cwd, false)
}
