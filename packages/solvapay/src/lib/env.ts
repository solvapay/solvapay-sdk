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
      'A SolvaPay key already exists. Overwrite? (y/n) ',
    )).trim().toLowerCase()
    return answer === 'y' || answer === 'yes'
  } finally {
    rl.close()
  }
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
