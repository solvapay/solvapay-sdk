import { spawn } from 'node:child_process'
import type { PackageManager, ScaffoldLanguage } from '@solvapay/init'
import type { InstallProjectResult } from '../types/mcp/scaffold'

export type ProjectInstallPlan = {
  command: string
  args: string[]
  fallback?: { command: string; args: string[] }
  missingMessage: string
}

export function projectInstallPlan(
  language: ScaffoldLanguage,
  packageManager: PackageManager = 'npm',
): ProjectInstallPlan {
  switch (language) {
    case 'ts':
      return {
        command: packageManager,
        args: ['install'],
        missingMessage: `${packageManager} is not installed.`,
      }
    case 'python':
      return {
        command: 'uv',
        args: ['sync'],
        fallback: { command: 'pip', args: ['install', '-e', '.'] },
        missingMessage:
          'Neither `uv` nor `pip` is installed. Install uv (https://docs.astral.sh/uv/) or pip, then re-run.',
      }
    case 'ruby':
      return {
        command: 'bundle',
        args: ['install'],
        missingMessage: '`bundle` is not installed. Install Bundler and re-run.',
      }
    case 'go':
      return {
        command: 'go',
        args: ['mod', 'tidy'],
        missingMessage: '`go` is not installed. Install Go and re-run.',
      }
    case 'rust':
      return {
        command: 'cargo',
        args: ['fetch'],
        missingMessage: '`cargo` is not installed. Install Rust and re-run.',
      }
  }
}

export async function installLanguageDependencies(
  language: ScaffoldLanguage,
  cwd: string,
  packageManager: PackageManager = 'npm',
  onProgress?: (message: string) => void,
): Promise<InstallProjectResult> {
  const plan = projectInstallPlan(language, packageManager)
  onProgress?.(`Installing ${language} dependencies`)
  const primary = await spawnInstall(plan.command, plan.args, cwd)
  if (primary.ok) return primary
  if (primary.warning?.includes('is not installed') && plan.fallback) {
    const fallback = await spawnInstall(plan.fallback.command, plan.fallback.args, cwd)
    if (fallback.ok) return fallback
    if (fallback.warning?.includes('is not installed')) {
      return { ok: false, command: fallback.command, warning: plan.missingMessage }
    }
    return fallback
  }
  if (primary.warning?.includes('is not installed')) {
    return { ok: false, command: primary.command, warning: plan.missingMessage }
  }
  return primary
}

const spawnInstall = (
  command: string,
  args: string[],
  cwd: string,
): Promise<InstallProjectResult> => {
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
