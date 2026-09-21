import { parseScaffoldLanguage, type ScaffoldLanguage } from '@solvapay/init'

export type ParsedInitArgs = {
  help: boolean
  yes: boolean
  dev: boolean
  productRef?: string
  language?: ScaffoldLanguage
  apiBaseUrl?: string
}

const readApiBaseValue = (argv: string[], index: number): string => {
  const value = argv[index]
  if (!value || value.startsWith('-')) {
    throw new Error('--api-base requires a URL')
  }
  return value
}

export function parseInitArgs(argv: string[]): ParsedInitArgs {
  let help = false
  let yes = false
  let dev = false
  let productRef: string | undefined
  let language: ScaffoldLanguage | undefined
  let apiBaseUrl: string | undefined
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') {
      help = true
    } else if (arg === '--yes' || arg === '-y') {
      yes = true
    } else if (arg === '--dev') {
      dev = true
    } else if (arg === '--api-base') {
      apiBaseUrl = readApiBaseValue(argv, ++i)
    } else if (arg === '--language' || arg === '-l') {
      const value = argv[++i]
      if (!value || value.startsWith('-')) {
        throw new Error('--language requires a value (ts, python, ruby, go, rust)')
      }
      const parsed = parseScaffoldLanguage(value)
      if (!parsed.ok) {
        throw new Error(parsed.reason)
      }
      language = parsed.language
    } else if (arg === '--product') {
      productRef = argv[++i]
      if (!productRef || productRef.startsWith('-')) {
        throw new Error('--product requires a product reference')
      }
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown init flag: ${arg}`)
    }
  }
  return { help, yes, dev, productRef, language, apiBaseUrl }
}

export function parseDoctorArgs(argv: string[]): {
  help: boolean
  dev: boolean
  apiBaseUrl?: string
} {
  let help = false
  let dev = false
  let apiBaseUrl: string | undefined
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') {
      help = true
    } else if (arg === '--dev') {
      dev = true
    } else if (arg === '--api-base') {
      apiBaseUrl = readApiBaseValue(argv, ++i)
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown doctor flag: ${arg}`)
    }
  }
  return { help, dev, apiBaseUrl }
}
