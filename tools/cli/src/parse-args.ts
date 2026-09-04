import { parseScaffoldLanguage, type ScaffoldLanguage } from '@solvapay/init'

export type ParsedInitArgs = {
  yes: boolean
  dev: boolean
  productRef?: string
  language?: ScaffoldLanguage
}

export function parseInitArgs(argv: string[]): ParsedInitArgs {
  let yes = false
  let dev = false
  let productRef: string | undefined
  let language: ScaffoldLanguage | undefined
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--yes' || arg === '-y') {
      yes = true
    } else if (arg === '--dev') {
      dev = true
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
  return { yes, dev, productRef, language }
}

export function parseDoctorArgs(argv: string[]): { dev: boolean } {
  let dev = false
  for (const arg of argv) {
    if (arg === '--dev') {
      dev = true
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown doctor flag: ${arg}`)
    }
  }
  return { dev }
}
