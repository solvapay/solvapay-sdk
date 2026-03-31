import { access, readFile, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import readline from 'node:readline/promises'
import { stdin, stdout } from 'node:process'

export type PackageManager = 'npm' | 'yarn' | 'pnpm'

export type EnsureNodeProjectResult = {
  filePath: string
  action: 'existing' | 'created' | 'cancelled'
}

type EnsureNodeProjectOptions = {
  cwd?: string
  confirmCreate?: () => Promise<boolean>
  autoCreate?: boolean
}

const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await access(filePath, constants.F_OK)
    return true
  } catch {
    return false
  }
}

const toPackageName = (cwd: string): string => {
  const baseName = path.basename(cwd)
  const sanitized = baseName
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')

  return sanitized || 'solvapay-app'
}

const askCreatePackageJson = async (): Promise<boolean> => {
  if (!stdin.isTTY || !stdout.isTTY) {
    return true
  }

  const rl = readline.createInterface({ input: stdin, output: stdout })
  try {
    const answer = (await rl.question('No package.json found. Create one now? (Y/n) '))
      .trim()
      .toLowerCase()
    if (!answer) {
      return true
    }
    return answer !== 'n' && answer !== 'no'
  } finally {
    rl.close()
  }
}

export const waitForEnter = async (message: string): Promise<void> => {
  if (!stdin.isTTY || !stdout.isTTY) {
    return
  }

  const rl = readline.createInterface({ input: stdin, output: stdout })
  try {
    await rl.question(message)
  } finally {
    rl.close()
  }
}

export const ensureNodeProject = async (
  options: EnsureNodeProjectOptions = {},
): Promise<EnsureNodeProjectResult> => {
  const cwd = options.cwd || process.cwd()
  const packageJsonPath = path.join(cwd, 'package.json')

  if (await fileExists(packageJsonPath)) {
    return { filePath: packageJsonPath, action: 'existing' }
  }

  const shouldCreate = options.autoCreate
    ? true
    : options.confirmCreate
      ? await options.confirmCreate()
      : await askCreatePackageJson()
  if (!shouldCreate) {
    return { filePath: packageJsonPath, action: 'cancelled' }
  }

  const packageJson = {
    name: toPackageName(cwd),
    version: '1.0.0',
    private: true,
  }

  await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8')
  return { filePath: packageJsonPath, action: 'created' }
}

export const detectPackageManager = async (cwd: string = process.cwd()): Promise<PackageManager> => {
  const lockfiles: Array<{ file: string; packageManager: PackageManager }> = [
    { file: 'pnpm-lock.yaml', packageManager: 'pnpm' },
    { file: 'yarn.lock', packageManager: 'yarn' },
    { file: 'package-lock.json', packageManager: 'npm' },
    { file: 'npm-shrinkwrap.json', packageManager: 'npm' },
  ]

  let currentDir = path.resolve(cwd)
  while (true) {
    for (const lockfile of lockfiles) {
      if (await fileExists(path.join(currentDir, lockfile.file))) {
        return lockfile.packageManager
      }
    }

    const packageJsonPath = path.join(currentDir, 'package.json')
    if (await fileExists(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8')) as {
          packageManager?: string
        }
        if (packageJson.packageManager?.startsWith('pnpm@')) return 'pnpm'
        if (packageJson.packageManager?.startsWith('yarn@')) return 'yarn'
        if (packageJson.packageManager?.startsWith('npm@')) return 'npm'
      } catch {
        // Ignore invalid package.json metadata and continue walking up.
      }
    }

    const parentDir = path.dirname(currentDir)
    if (parentDir === currentDir) {
      break
    }
    currentDir = parentDir
  }

  return 'npm'
}
