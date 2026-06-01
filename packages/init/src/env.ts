import { access, readFile, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import readline from 'node:readline/promises'
import { stdin, stdout } from 'node:process'

const SOLVAPAY_SECRET_KEY = 'SOLVAPAY_SECRET_KEY'
const SOLVAPAY_PRODUCT_REF = 'SOLVAPAY_PRODUCT_REF'
const SOLVAPAY_API_BASE_URL = 'SOLVAPAY_API_BASE_URL'

export const SOLVAPAY_PRODUCT_REF_PLACEHOLDER = '__SOLVAPAY_PRODUCT_REF__'

const envValueRegex = (key: string) => new RegExp(`^\\s*${key}\\s*=\\s*(.*)$`, 'm')

export type EnvWriteResult = {
  filePath: string
  action: 'created' | 'appended' | 'updated' | 'unchanged'
}

export type GitignoreEnvResult = {
  filePath: string
  action: 'created' | 'appended' | 'unchanged'
}

type EnvWriteOptions = {
  cwd?: string
  confirmOverwrite?: () => Promise<boolean>
}

const secretKeyRegex = envValueRegex(SOLVAPAY_SECRET_KEY)

const parseEnvValue = (raw: string): string => {
  const trimmed = raw.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim()
  }
  return trimmed
}

const normalizeTrailingNewline = (content: string): string =>
  content.endsWith('\n') ? content : `${content}\n`

const askOverwrite = async (): Promise<boolean> => {
  const rl = readline.createInterface({ input: stdin, output: stdout })
  try {
    const answer = (await rl.question(
      "You're already set up. Overwrite SOLVAPAY_SECRET_KEY? (y/N) ",
    )).trim().toLowerCase()
    return answer === 'y' || answer === 'yes'
  } finally {
    rl.close()
  }
}

const hasEnvGitignoreEntry = (content: string): boolean =>
  content
    .split('\n')
    .map(line => line.trim())
    .some(line => line === '.env' || line === '/.env')

export const ensureEnvInGitignore = async (cwd: string = process.cwd()): Promise<GitignoreEnvResult> => {
  const gitignorePath = path.join(cwd, '.gitignore')
  const exists = await envFileExists(gitignorePath)

  if (!exists) {
    await writeFile(gitignorePath, '.env\n', 'utf8')
    return { filePath: gitignorePath, action: 'created' }
  }

  const currentContent = await readFile(gitignorePath, 'utf8')
  if (hasEnvGitignoreEntry(currentContent)) {
    return { filePath: gitignorePath, action: 'unchanged' }
  }

  const next = `${normalizeTrailingNewline(currentContent)}.env\n`
  await writeFile(gitignorePath, next, 'utf8')
  return { filePath: gitignorePath, action: 'appended' }
}

const envFileExists = async (envPath: string): Promise<boolean> => {
  try {
    await access(envPath, constants.F_OK)
    return true
  } catch {
    return false
  }
}

export const writeSolvaPaySecretToEnv = async (
  secretKey: string,
  options: EnvWriteOptions = {},
): Promise<EnvWriteResult> => {
  const envPath = path.join(options.cwd || process.cwd(), '.env')
  const keyLine = `${SOLVAPAY_SECRET_KEY}=${secretKey}`

  const exists = await envFileExists(envPath)
  if (!exists) {
    await writeFile(envPath, `${keyLine}\n`, 'utf8')
    return { filePath: envPath, action: 'created' }
  }

  const currentContent = await readFile(envPath, 'utf8')

  if (!secretKeyRegex.test(currentContent)) {
    const next = `${normalizeTrailingNewline(currentContent)}${keyLine}\n`
    await writeFile(envPath, next, 'utf8')
    return { filePath: envPath, action: 'appended' }
  }

  const shouldOverwrite = options.confirmOverwrite
    ? await options.confirmOverwrite()
    : await askOverwrite()
  if (!shouldOverwrite) {
    return { filePath: envPath, action: 'unchanged' }
  }

  const updatedContent = currentContent.replace(
    /^\s*SOLVAPAY_SECRET_KEY\s*=.*$/m,
    keyLine,
  )
  await writeFile(envPath, updatedContent, 'utf8')
  return { filePath: envPath, action: 'updated' }
}

export const readSolvaPayProductRefFromEnv = async (
  cwd: string = process.cwd(),
): Promise<string | undefined> => {
  const envPath = path.join(cwd, '.env')
  const exists = await envFileExists(envPath)
  if (!exists) {
    return undefined
  }

  const content = await readFile(envPath, 'utf8')
  const match = content.match(envValueRegex(SOLVAPAY_PRODUCT_REF))
  if (!match?.[1]) {
    return undefined
  }

  const value = parseEnvValue(match[1])
  return value.length > 0 ? value : undefined
}

export const writeSolvaPayProductRefToEnv = async (
  productRef: string,
  options: { cwd?: string } = {},
): Promise<EnvWriteResult> => {
  const envPath = path.join(options.cwd || process.cwd(), '.env')
  const keyLine = `${SOLVAPAY_PRODUCT_REF}=${productRef}`

  const exists = await envFileExists(envPath)
  if (!exists) {
    await writeFile(envPath, `${keyLine}\n`, 'utf8')
    return { filePath: envPath, action: 'created' }
  }

  const currentContent = await readFile(envPath, 'utf8')
  const productRefRegex = envValueRegex(SOLVAPAY_PRODUCT_REF)

  if (!productRefRegex.test(currentContent)) {
    const next = `${normalizeTrailingNewline(currentContent)}${keyLine}\n`
    await writeFile(envPath, next, 'utf8')
    return { filePath: envPath, action: 'appended' }
  }

  const match = currentContent.match(productRefRegex)
  const currentValue = match?.[1] ? parseEnvValue(match[1]) : ''
  if (currentValue === productRef) {
    return { filePath: envPath, action: 'unchanged' }
  }

  const updatedContent = currentContent.replace(/^\s*SOLVAPAY_PRODUCT_REF\s*=.*$/m, keyLine)
  await writeFile(envPath, updatedContent, 'utf8')
  return { filePath: envPath, action: 'updated' }
}

/**
 * Persist `SOLVAPAY_API_BASE_URL=<url>` to the project's `.env`. Append-safe
 * and idempotent — mirrors `writeSolvaPaySecretToEnv` / `writeSolvaPayProductRefToEnv`:
 *   - creates `.env` if missing,
 *   - appends the line if the key is absent,
 *   - replaces the existing value in place when different,
 *   - no-ops when the value already matches.
 *
 * Honors any leading `#` comment marker on existing lines (e.g. the
 * `.env.example` placeholder `# SOLVAPAY_API_BASE_URL=…`) by replacing the
 * entire commented line — so re-running `solvapay init --dev` flips the
 * placeholder to a live override without leaving a stale commented copy
 * above it.
 */
export const writeSolvaPayApiBaseUrlToEnv = async (
  url: string,
  options: { cwd?: string } = {},
): Promise<EnvWriteResult> => {
  const envPath = path.join(options.cwd || process.cwd(), '.env')
  const keyLine = `${SOLVAPAY_API_BASE_URL}=${url}`

  const exists = await envFileExists(envPath)
  if (!exists) {
    await writeFile(envPath, `${keyLine}\n`, 'utf8')
    return { filePath: envPath, action: 'created' }
  }

  const currentContent = await readFile(envPath, 'utf8')
  const liveRegex = new RegExp(`^\\s*${SOLVAPAY_API_BASE_URL}\\s*=\\s*(.*)$`, 'm')
  const commentedRegex = new RegExp(`^\\s*#\\s*${SOLVAPAY_API_BASE_URL}\\s*=.*$`, 'm')

  if (liveRegex.test(currentContent)) {
    const match = currentContent.match(liveRegex)
    const currentValue = match?.[1] ? parseEnvValue(match[1]) : ''
    if (currentValue === url) {
      return { filePath: envPath, action: 'unchanged' }
    }
    const updatedContent = currentContent.replace(liveRegex, keyLine)
    await writeFile(envPath, updatedContent, 'utf8')
    return { filePath: envPath, action: 'updated' }
  }

  if (commentedRegex.test(currentContent)) {
    const updatedContent = currentContent.replace(commentedRegex, keyLine)
    await writeFile(envPath, updatedContent, 'utf8')
    return { filePath: envPath, action: 'updated' }
  }

  const next = `${normalizeTrailingNewline(currentContent)}${keyLine}\n`
  await writeFile(envPath, next, 'utf8')
  return { filePath: envPath, action: 'appended' }
}
