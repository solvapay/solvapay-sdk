import { spawn } from 'node:child_process'
import type { PackageManager } from './project'
import type { PythonManager } from './language'
import { GO_MODULE, PYPI_PACKAGE } from './sdk-registry'

export type InstallResult = {
  ok: boolean
  command: string
  warning?: string
}

const MAX_ERROR_LOG_LINES = 30

const SOLVAPAY_BASE_PACKAGES = ['@solvapay/server', '@solvapay/core', '@solvapay/auth']

/**
 * What a project uses SolvaPay for (`--features mcp,agents,web`). Each adds a
 * Python extra, or a TypeScript package. Go needs nothing: one module.
 */
export const SDK_FEATURES = ['mcp', 'agents', 'web'] as const
export type SdkFeature = (typeof SDK_FEATURES)[number]

const TS_FEATURE_PACKAGES: Record<SdkFeature, string> = {
  mcp: '@solvapay/mcp',
  agents: '@solvapay/agents',
  web: '@solvapay/react',
}

export const parseFeatures = (value: string): SdkFeature[] => {
  const features = value
    .split(',')
    .map(part => part.trim().toLowerCase())
    .filter(Boolean)
  for (const feature of features) {
    if (!(SDK_FEATURES as readonly string[]).includes(feature)) {
      throw new Error(
        `Unknown feature "${feature}" in --features. Use: ${SDK_FEATURES.join(', ')}.`,
      )
    }
  }
  return [...new Set(features)] as SdkFeature[]
}

export type TsInstallOptions = {
  /** npm dist-tag: `latest`, or `preview` with `--preview`. */
  distTag?: 'latest' | 'preview'
  features?: SdkFeature[]
}

export const getSolvaPayBasePackages = (features: SdkFeature[] = []): string[] => [
  ...SOLVAPAY_BASE_PACKAGES,
  ...features.map(feature => TS_FEATURE_PACKAGES[feature]),
]

const getPackageSpecifiers = async (options: TsInstallOptions = {}): Promise<string[]> => {
  const distTag = options.distTag ?? 'latest'
  return getSolvaPayBasePackages(options.features).map(pkg => `${pkg}@${distTag}`)
}

export const getInstallCommand = async (
  packageManager: PackageManager,
  options: TsInstallOptions = {},
): Promise<string> => {
  const packageSpecifiers = await getPackageSpecifiers(options)
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

const ANSI_ESCAPE_RE = new RegExp(`${String.fromCharCode(0x1b)}\\[[0-9;]*m`, 'g')
const trimLine = (line: string): string => line.replace(ANSI_ESCAPE_RE, '').trim()

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
  options: TsInstallOptions = {},
): Promise<InstallResult> => {
  const packageSpecifiers = await getPackageSpecifiers(options)
  const command = await getInstallCommand(packageManager, options)
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

// --- Python and Go

/** One command a language install runs, as argv (no shell). */
export type SdkCommand = { cmd: string; args: string[] }

export const formatCommand = ({ cmd, args }: SdkCommand): string =>
  [cmd, ...args.map(arg => (/^[\w@./:=+-]+$/.test(arg) ? arg : `'${arg}'`))].join(' ')

/** `solvapay[mcp,agents]==0.1.0` — the requirement that pins the Python SDK exactly. */
export const pythonRequirement = (version: string, features: SdkFeature[] = []): string =>
  `${PYPI_PACKAGE}${features.length ? `[${features.join(',')}]` : ''}==${version}`

/**
 * What installs the Python SDK. uv and Poetry manage the project's own
 * environment, so init runs them. For pip it runs nothing: which interpreter
 * to install into is the developer's choice, so init prints the command.
 */
export const pythonInstallCommands = (
  manager: PythonManager,
  version: string,
  features: SdkFeature[] = [],
): { run: SdkCommand[]; print: SdkCommand[] } => {
  const requirement = pythonRequirement(version, features)
  if (manager === 'uv') return { run: [{ cmd: 'uv', args: ['add', requirement] }], print: [] }
  if (manager === 'poetry')
    return { run: [{ cmd: 'poetry', args: ['add', requirement] }], print: [] }
  return { run: [], print: [{ cmd: 'python', args: ['-m', 'pip', 'install', requirement] }] }
}

/**
 * What installs the Go SDK. Only `go get`: a `go mod tidy` here would drop the
 * requirement again while no file imports the module yet.
 */
export const goInstallCommands = (version: string): SdkCommand[] => [
  { cmd: 'go', args: ['get', `${GO_MODULE}@${version}`] },
]

/** Runs one command in `cwd`; the last lines of its output explain a failure. */
export const runSdkCommand = (command: SdkCommand, cwd: string): Promise<InstallResult> =>
  new Promise(resolve => {
    const display = formatCommand(command)
    const lines: string[] = []
    const child = spawn(command.cmd, command.args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    })
    const record = (chunk: Buffer) => {
      for (const line of chunk.toString('utf8').split(/\r?\n/)) {
        const trimmed = trimLine(line)
        if (!trimmed) continue
        lines.push(trimmed)
        if (lines.length > MAX_ERROR_LOG_LINES) lines.shift()
      }
    }
    child.stdout?.on('data', record)
    child.stderr?.on('data', record)
    child.once('error', error => {
      const missing = (error as NodeJS.ErrnoException).code === 'ENOENT'
      resolve({
        ok: false,
        command: display,
        warning: missing ? `${command.cmd} is not installed or not on PATH` : error.message,
      })
    })
    child.once('close', code => {
      resolve(
        code === 0
          ? { ok: true, command: display }
          : {
              ok: false,
              command: display,
              warning: `exited with code ${code ?? 'unknown'}${lines.length ? `\n${lines.join('\n')}` : ''}`,
            },
      )
    })
  })
