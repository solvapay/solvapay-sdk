import { describe, expect, it } from 'vitest'
import { sdkInstallPlan } from './install'

describe('sdkInstallPlan', () => {
  it('uses uv add for Python with pip fallback', () => {
    const plan = sdkInstallPlan('python')
    expect(plan.command).toBe('uv')
    expect(plan.args).toEqual(['add', 'solvapay', 'solvapay-mcp'])
    expect(plan.fallback).toEqual({ command: 'pip', args: ['install', 'solvapay', 'solvapay-mcp'] })
    expect(plan.missingMessage).toMatch(/uv/)
  })

  it('uses bundle add for Ruby', () => {
    const plan = sdkInstallPlan('ruby')
    expect(plan.command).toBe('bundle')
    expect(plan.args).toEqual(['add', 'solvapay', 'solvapay-mcp'])
  })

  it('uses go get for Go', () => {
    const plan = sdkInstallPlan('go')
    expect(plan.args).toEqual(['get', 'github.com/solvapay/solvapay-go@latest'])
  })

  it('uses cargo add for Rust', () => {
    const plan = sdkInstallPlan('rust')
    expect(plan.args).toEqual(['add', 'solvapay', 'solvapay-mcp'])
  })
})
