import { parseFeatures, parseLanguage, type InitCommandOptions } from '@solvapay/init'
import type { VerifyCommandOptions } from './commands/verify'

function valueOf(argv: string[], i: number, flag: string): string {
  const value = argv[i]
  if (!value || value.startsWith('-')) throw new Error(`${flag} requires a value`)
  return value
}

export function parseInitArgs(argv: string[]): InitCommandOptions {
  const options: InitCommandOptions = { yes: false, dev: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--yes' || arg === '-y') {
      options.yes = true
    } else if (arg === '--dev') {
      options.dev = true
    } else if (arg === '--preview') {
      options.preview = true
    } else if (arg === '--product') {
      options.productRef = valueOf(argv, ++i, '--product')
    } else if (arg === '--language') {
      options.language = parseLanguage(valueOf(argv, ++i, '--language'))
    } else if (arg === '--features') {
      options.features = parseFeatures(valueOf(argv, ++i, '--features'))
    } else {
      throw new Error(`Unknown init flag: ${arg}`)
    }
  }
  return options
}

export function parseVerifyArgs(argv: string[]): VerifyCommandOptions {
  let serverUrl: string | undefined
  let credentialsFile: string | undefined
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--credentials-file') {
      credentialsFile = valueOf(argv, ++i, '--credentials-file')
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown verify flag: ${arg}`)
    } else if (serverUrl === undefined) {
      serverUrl = arg
    } else {
      throw new Error(`verify takes one server URL, got "${serverUrl}" and "${arg}"`)
    }
  }
  if (!serverUrl) throw new Error('Usage: solvapay verify <server url> [--credentials-file <path>]')
  return { serverUrl, credentialsFile }
}
