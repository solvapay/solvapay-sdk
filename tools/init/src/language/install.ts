import { spawn } from 'node:child_process'
import type { InstallResult } from '../install'
import { getInstallCommand, installSolvaPaySdk } from '../install'
import { detectPackageManager } from '../project'
import { LANGUAGE_LABELS, type ScaffoldLanguage } from './ids'

export type SdkInstallPlan = {
  command: string
  args: string[]
  fallback?: { command: string; args: string[] }
  missingMessage: string
}

const spawnResult = (command: string, args: string[], cwd: string): Promise<InstallResult> => {
  const pretty = `${command} ${args.join(' ')}`
  return new Promise(resolve => {
    const child = spawn(command, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    })
    const errorLines: string[] = []
    const handleChunk = (chunk: Buffer): void => {
      for (const line of chunk.toString('utf8').split(/\r?\n|\r/g)) {
        if (!line.trim()) continue
        errorLines.push(line.trim())
        if (errorLines.length > 30) errorLines.shift()
      }
    }
    child.stdout?.on('data', handleChunk)
    child.stderr?.on('data', handleChunk)
    child.once('error', error => {
      const missing =
        error.message.includes('ENOENT') || (error as NodeJS.ErrnoException).code === 'ENOENT'
      resolve({
        ok: false,
        command: pretty,
        warning: missing ? `${command} is not installed` : error.message,
      })
    })
    child.once('close', code => {
      if (code === 0) {
        resolve({ ok: true, command: pretty })
        return
      }
      resolve({
        ok: false,
        command: pretty,
        warning: `${pretty} exited with code ${code ?? 'unknown'}${
          errorLines.length ? `\n${errorLines.slice(-10).join('\n')}` : ''
        }`,
      })
    })
  })
}

export function sdkInstallPlan(language: ScaffoldLanguage): SdkInstallPlan {
  switch (language) {
    case 'ts':
      return {
        command: 'npm',
        args: [
          'install',
          '@solvapay/server@latest',
          '@solvapay/core@latest',
          '@solvapay/auth@latest',
        ],
        missingMessage:
          'npm is required to install the SolvaPay TypeScript SDK. Install Node.js from https://nodejs.org and re-run.',
      }
    case 'python':
      return {
        command: 'uv',
        args: ['add', 'solvapay', 'solvapay-mcp'],
        fallback: { command: 'pip', args: ['install', 'solvapay', 'solvapay-mcp'] },
        missingMessage:
          'Neither `uv` nor `pip` is installed. Install uv (https://docs.astral.sh/uv/) or Python pip, then re-run.',
      }
    case 'ruby':
      return {
        command: 'bundle',
        args: ['add', 'solvapay', 'solvapay-mcp'],
        missingMessage:
          '`bundle` is not installed. Install Bundler (`gem install bundler`) and re-run.',
      }
    case 'go':
      return {
        command: 'go',
        args: ['get', 'github.com/solvapay/solvapay-sdk/sdks/go@latest'],
        missingMessage: '`go` is not installed. Install Go from https://go.dev/dl/ and re-run.',
      }
    case 'rust':
      return {
        command: 'cargo',
        args: ['add', 'solvapay', 'solvapay-mcp'],
        missingMessage: '`cargo` is not installed. Install Rust from https://rustup.rs and re-run.',
      }
  }
}

export async function installSdk(
  language: ScaffoldLanguage,
  cwd: string,
  onProgress?: (message: string) => void,
): Promise<InstallResult> {
  if (language === 'ts') {
    const packageManager = await detectPackageManager(cwd)
    return installSolvaPaySdk(packageManager, cwd, onProgress)
  }

  const plan = sdkInstallPlan(language)
  onProgress?.(`Installing SolvaPay ${LANGUAGE_LABELS[language]} SDK`)
  const primary = await spawnResult(plan.command, plan.args, cwd)
  if (primary.ok) return primary

  const missingPrimary = primary.warning?.includes('is not installed')
  if (missingPrimary && plan.fallback) {
    const fallback = await spawnResult(plan.fallback.command, plan.fallback.args, cwd)
    if (fallback.ok) return fallback
    if (fallback.warning?.includes('is not installed')) {
      return { ok: false, command: fallback.command, warning: plan.missingMessage }
    }
    return fallback
  }
  if (missingPrimary) {
    return { ok: false, command: primary.command, warning: plan.missingMessage }
  }
  return primary
}

export async function getLanguageInstallCommand(language: ScaffoldLanguage): Promise<string> {
  if (language === 'ts') {
    return getInstallCommand(await detectPackageManager())
  }
  const plan = sdkInstallPlan(language)
  return `${plan.command} ${plan.args.join(' ')}`
}
