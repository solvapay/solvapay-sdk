import { spawn } from 'node:child_process'
import type { PackageManager } from './project'

export type InstallResult = {
  ok: boolean
  command: string
  warning?: string
}

const SOLVAPAY_SDK_PACKAGES = ['@solvapay/server@latest', '@solvapay/core@latest']

export const getInstallCommand = (packageManager: PackageManager): string => {
  if (packageManager === 'yarn') {
    return 'yarn add @solvapay/server@latest @solvapay/core@latest'
  }
  if (packageManager === 'pnpm') {
    return 'pnpm add @solvapay/server@latest @solvapay/core@latest'
  }
  return 'npm install @solvapay/server@latest @solvapay/core@latest'
}

const getInstallArgs = (packageManager: PackageManager): string[] => {
  if (packageManager === 'yarn') {
    return ['add', ...SOLVAPAY_SDK_PACKAGES]
  }
  if (packageManager === 'pnpm') {
    return ['add', ...SOLVAPAY_SDK_PACKAGES]
  }
  return ['install', ...SOLVAPAY_SDK_PACKAGES]
}

export const installSolvaPaySdk = async (
  packageManager: PackageManager,
  cwd: string = process.cwd(),
): Promise<InstallResult> => {
  const command = getInstallCommand(packageManager)

  return new Promise(resolve => {
    const child = spawn(packageManager, getInstallArgs(packageManager), {
      cwd,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    })

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
        warning: `Installer exited with code ${code ?? 'unknown'}`,
      })
    })
  })
}
