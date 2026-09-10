import { describe, expect, it } from 'vitest'
import { PORTAL_AUTO_RECHARGE_QUERY, autoRechargeUrlFrom } from '../src/portal-links'

describe('autoRechargeUrlFrom', () => {
  it('appends the credits + autorecharge query when the URL already has a query', () => {
    expect(autoRechargeUrlFrom('https://pay.example/manage?id=sess_1')).toBe(
      `https://pay.example/manage?id=sess_1&${PORTAL_AUTO_RECHARGE_QUERY}`,
    )
  })

  it('uses ? when the minted URL has no query string', () => {
    expect(autoRechargeUrlFrom('https://pay.example/manage')).toBe(
      `https://pay.example/manage?${PORTAL_AUTO_RECHARGE_QUERY}`,
    )
  })

  it('returns null for a missing URL', () => {
    expect(autoRechargeUrlFrom(null)).toBeNull()
    expect(autoRechargeUrlFrom(undefined)).toBeNull()
    expect(autoRechargeUrlFrom('')).toBeNull()
  })

  it('returns null for a non-http URL', () => {
    expect(autoRechargeUrlFrom('javascript:alert(1)')).toBeNull()
    expect(autoRechargeUrlFrom('/manage?id=sess_1')).toBeNull()
    expect(autoRechargeUrlFrom('ftp://pay.example/manage')).toBeNull()
  })
})
