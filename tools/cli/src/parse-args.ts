import { parseScaffoldLanguage, type ScaffoldLanguage } from '@solvapay/init'

export type ParsedInitArgs = {
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
  let yes = false
  let dev = false
  let productRef: string | undefined
  let language: ScaffoldLanguage | undefined
  let apiBaseUrl: string | undefined
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--yes' || arg === '-y') {
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
    }
  }
  return { yes, dev, productRef, language, apiBaseUrl }
}

export function parseDoctorArgs(argv: string[]): { dev: boolean; apiBaseUrl?: string } {
  let dev = false
  let apiBaseUrl: string | undefined
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--dev') {
      dev = true
    } else if (arg === '--api-base') {
      apiBaseUrl = readApiBaseValue(argv, ++i)
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown doctor flag: ${arg}`)
    }
  }
  return { dev, apiBaseUrl }
}
