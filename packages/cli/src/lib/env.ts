import { access, readFile, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import readline from 'node:readline/promises'
import { stdin, stdout } from 'node:process'

const SOLVAPAY_SECRET_KEY = 'SOLVAPAY_SECRET_KEY'

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

const envKeyRegex = new RegExp(`^\\s*${SOLVAPAY_SECRET_KEY}\\s*=`, 'm')

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

  if (!envKeyRegex.test(currentContent)) {
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
