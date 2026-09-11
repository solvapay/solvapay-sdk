import { describe, expect, it } from 'vitest'
import { getInstallCommand, getSolvaPayBasePackages } from './install'

describe('getSolvaPayBasePackages', () => {
  it('returns the canonical three-package list', () => {
    expect(getSolvaPayBasePackages()).toEqual([
      '@solvapay/server',
      '@solvapay/core',
      '@solvapay/auth',
    ])
  })

  it('returns a fresh copy so callers cannot mutate the canonical list', () => {
    const first = getSolvaPayBasePackages()
    first.push('@solvapay/contraband')
    expect(getSolvaPayBasePackages()).toEqual([
      '@solvapay/server',
      '@solvapay/core',
      '@solvapay/auth',
    ])
  })
})

describe('getInstallCommand', () => {
  it('returns `npm install <packages>` for npm', async () => {
    const command = await getInstallCommand('npm')
    expect(command.startsWith('npm install ')).toBe(true)
    expect(command).toContain('@solvapay/server@latest')
    expect(command).toContain('@solvapay/core@latest')
    expect(command).toContain('@solvapay/auth@latest')
  })

  it('returns `pnpm add <packages>` for pnpm', async () => {
    const command = await getInstallCommand('pnpm')
    expect(command.startsWith('pnpm add ')).toBe(true)
    expect(command).toContain('@solvapay/server@latest')
  })

  it('returns `yarn add <packages>` for yarn', async () => {
    const command = await getInstallCommand('yarn')
    expect(command.startsWith('yarn add ')).toBe(true)
    expect(command).toContain('@solvapay/server@latest')
  })
})
