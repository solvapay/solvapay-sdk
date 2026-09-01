import { describe, expect, it } from 'vitest'
import {
  evaluateWorkTiers,
  formatDoctorReport,
  pinnedPnpmVersion,
  pinnedRustChannel,
  runDoctor,
  type ToolCheck,
  type ToolProbe,
} from './doctor.js'

const ready: ToolCheck = {
  id: 'node',
  label: 'node',
  status: 'ok',
  detail: 'v20.0.0',
  requiredFor: ['ts-only', 'codegen', 'parity'],
}

function check(
  id: string,
  status: ToolCheck['status'],
  requiredFor: ToolCheck['requiredFor'],
): ToolCheck {
  return { id, label: id, status, detail: status, requiredFor }
}

describe('evaluateWorkTiers', () => {
  it('marks TS-only ready when node and pnpm are ok', () => {
    const tiers = evaluateWorkTiers([
      check('node', 'ok', ['ts-only', 'codegen', 'parity']),
      check('pnpm', 'ok', ['ts-only', 'codegen', 'parity']),
      check('cargo', 'missing', ['codegen', 'parity']),
    ])
    expect(tiers).toEqual({
      'ts-only': true,
      codegen: false,
      parity: false,
    })
  })

  it('marks codegen ready only when cargo matches the pin', () => {
    const tiers = evaluateWorkTiers([
      check('node', 'ok', ['ts-only', 'codegen', 'parity']),
      check('pnpm', 'ok', ['ts-only', 'codegen', 'parity']),
      check('cargo', 'ok', ['codegen', 'parity']),
      check('maturin', 'missing', ['parity']),
    ])
    expect(tiers.codegen).toBe(true)
    expect(tiers.parity).toBe(false)
  })
})

describe('pinned toolchain files', () => {
  it('reads the rust-toolchain.toml channel', () => {
    expect(pinnedRustChannel()).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('reads the packageManager pnpm pin', () => {
    expect(pinnedPnpmVersion()).toMatch(/^\d+\.\d+\.\d+$/)
  })
})

describe('runDoctor', () => {
  it('reports ready TS-only when optional tools are missing', () => {
    const probe: ToolProbe = (bin: string) => {
      if (bin === 'node') {
        return { present: true, version: 'v20.19.0' }
      }
      if (bin === 'pnpm') {
        return { present: true, version: pinnedPnpmVersion() }
      }
      if (bin === 'cargo' || bin === 'rustc') {
        return { present: true, version: pinnedRustChannel() }
      }
      return { present: false }
    }
    const result = runDoctor({ probe })
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toMatch(/TS-only/)
    expect(result.stdout).toMatch(/codegen/)
    expect(result.stdout).toMatch(/parity/)
    expect(formatDoctorReport(result.checks, result.tiers)).toMatch(/ready/)
    expect(result.checks.some(item => item.id === 'node' && item.status === 'ok')).toBe(true)
  })

  it('exits 1 when node is missing', () => {
    const result = runDoctor({
      probe: () => ({ present: false }),
    })
    expect(result.exitCode).toBe(1)
    expect(result.tiers['ts-only']).toBe(false)
  })
})

describe('formatDoctorReport', () => {
  it('lists each work tier', () => {
    const report = formatDoctorReport([ready, { ...ready, id: 'pnpm', label: 'pnpm' }], {
      'ts-only': true,
      codegen: false,
      parity: false,
    })
    expect(report).toMatch(/TS-only/)
    expect(report).toMatch(/codegen/)
    expect(report).toMatch(/parity/)
  })
})
