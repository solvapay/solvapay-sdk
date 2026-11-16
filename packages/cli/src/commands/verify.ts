import { readFile } from 'node:fs/promises'
import { verifyServer } from '../verify/verify'

export type VerifyCommandOptions = {
  serverUrl: string
  /** JSON file with an `accessToken` (e.g. from `mcpjam oauth login --credentials-out`). */
  credentialsFile?: string
}

const readBearerToken = async (file: string): Promise<string> => {
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(file, 'utf8'))
  } catch (error) {
    throw new Error(
      `Could not read --credentials-file ${file}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  const token = (parsed as { accessToken?: unknown } | null)?.accessToken
  if (typeof token !== 'string' || token.length === 0) {
    throw new Error(`--credentials-file ${file} has no "accessToken" string`)
  }
  return token
}

/** Prints the JSON summary; exit code 1 when any check failed. */
export const runVerifyCommand = async ({
  serverUrl,
  credentialsFile,
}: VerifyCommandOptions): Promise<void> => {
  if (!/^https?:\/\//i.test(serverUrl)) {
    throw new Error(`verify needs the server's http(s) URL, got "${serverUrl}"`)
  }
  const bearerToken = credentialsFile ? await readBearerToken(credentialsFile) : undefined
  const summary = await verifyServer(serverUrl, { bearerToken })
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
  if (summary.overall !== 'passed') process.exitCode = 1
}
