import { spawn } from 'node:child_process'
import type { PackageManager } from './project'

export type InstallResult = {
  ok: boolean
  command: string
  warning?: string
}

const MAX_ERROR_LOG_LINES = 30

const DEFAULT_DIST_TAG = 'latest'
const SOLVAPAY_BASE_PACKAGES = ['@solvapay/server', '@solvapay/core', '@solvapay/auth']

export const getSolvaPayBasePackages = (): string[] => [...SOLVAPAY_BASE_PACKAGES]

const getPackageSpecifiers = async (): Promise<string[]> => {
  const distTag = DEFAULT_DIST_TAG
  return SOLVAPAY_BASE_PACKAGES.map(pkg => `${pkg}@${distTag}`)
}

export const getInstallCommand = async (packageManager: PackageManager): Promise<string> => {
  const packageSpecifiers = await getPackageSpecifiers()
  const packageArgs = packageSpecifiers.join(' ')

  if (packageManager === 'yarn') {
    return `yarn add ${packageArgs}`
  }
  if (packageManager === 'pnpm') {
    return `pnpm add ${packageArgs}`
  }
  return `npm install ${packageArgs}`
}

const getInstallArgs = (packageManager: PackageManager, packageSpecifiers: string[]): string[] => {
  if (packageManager === 'yarn') {
    return ['add', ...packageSpecifiers]
  }
  if (packageManager === 'pnpm') {
    return ['add', ...packageSpecifiers]
  }
  return ['install', ...packageSpecifiers]
}

const trimLine = (line: string): string => line.replace(/\u001B\[[0-9;]*m/g, '').trim()

const parsePnpmProgress = (line: string): string | null => {
  const progressMatch = line.match(/Progress:\s*resolved\s+(\d+).+downloaded\s+(\d+).+added\s+(\d+)/)
  if (progressMatch) {
    const [, resolved, downloaded, added] = progressMatch
    return `Installing packages (${added} added, ${downloaded} downloaded, ${resolved} resolved)`
  }

  if (line.includes('Progress:')) {
    return 'Installing packages'
  }

  if (line.includes('Done in')) {
    return 'Finalizing install'
  }

  return null
}

const parseYarnProgress = (line: string): string | null => {
  if (/\[\d+\/\d+\]\s+Resolving packages/.test(line) || line.includes('Resolution step')) {
    return 'Resolving packages'
  }
  if (/\[\d+\/\d+\]\s+Fetching packages/.test(line) || line.includes('Fetch step')) {
    return 'Downloading packages'
  }
  if (/\[\d+\/\d+\]\s+Linking dependencies/.test(line) || line.includes('Link step')) {
    return 'Linking dependencies'
  }
  if (/\[\d+\/\d+\]\s+Building fresh packages/.test(line) || line.includes('Building packages')) {
    return 'Building packages'
  }
  if (line.includes('Done in') || line.toLowerCase().includes('done with warnings')) {
    return 'Finalizing install'
  }
  return null
}

const parseNpmProgress = (line: string): string | null => {
  const lower = line.toLowerCase()
  if (lower.includes('idealtree')) {
    return 'Resolving packages'
  }
  if (lower.includes('reify')) {
    return 'Installing packages'
  }
  if (lower.startsWith('added ') || lower.includes('audited ')) {
    return 'Finalizing install'
  }
  return null
}

const getProgressMessage = (packageManager: PackageManager, rawLine: string): string | null => {
  const line = trimLine(rawLine)
  if (!line) {
    return null
  }

  if (packageManager === 'pnpm') {
    return parsePnpmProgress(line)
  }
  if (packageManager === 'yarn') {
    return parseYarnProgress(line)
  }
  return parseNpmProgress(line)
}

export const installSolvaPaySdk = async (
  packageManager: PackageManager,
  cwd: string = process.cwd(),
  onProgress?: (message: string) => void,
): Promise<InstallResult> => {
  const packageSpecifiers = await getPackageSpecifiers()
  const command = await getInstallCommand(packageManager)
  const errorLines: string[] = []
  let lastProgressMessage = ''

  return new Promise(resolve => {
    const child = spawn(packageManager, getInstallArgs(packageManager, packageSpecifiers), {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    })

    const recordLine = (line: string) => {
      const trimmed = trimLine(line)
      if (!trimmed) {
        return
      }
      errorLines.push(trimmed)
      if (errorLines.length > MAX_ERROR_LOG_LINES) {
        errorLines.shift()
      }
    }

    const emitProgress = (line: string) => {
      const message = getProgressMessage(packageManager, line)
      if (!message || message === lastProgressMessage) {
        return
      }
      lastProgressMessage = message
      onProgress?.(message)
    }

    const handleChunk = (chunk: Buffer) => {
      const text = chunk.toString('utf8')
      const lines = text.split(/\r?\n|\r/g)
      for (const line of lines) {
        recordLine(line)
        emitProgress(line)
      }
    }

    child.stdout?.on('data', handleChunk)
    child.stderr?.on('data', handleChunk)

    child.once('error', error => {
      resolve({
        ok: false,
        command,
        warning: error.message,
      })
    })

    child.once('close', code => {
      if (code === 0) {
        resolve({ ok: true, command })
        return
      }

      resolve({
        ok: false,
        command,
        warning: `Installer exited with code ${code ?? 'unknown'}${
          errorLines.length ? `\n${errorLines.join('\n')}` : ''
        }`,
      })
    })
  })
}
