import { describe, expect, it } from 'vitest'

import { SOLVAPAY_AUTHORIZATION_HEADER, SOLVAPAY_USER_ID_HEADER } from './constants'

describe('auth header constants', () => {
  it('exports x-user-id header name', () => {
    expect(SOLVAPAY_USER_ID_HEADER).toBe('x-user-id')
  })

  it('exports authorization header name', () => {
    expect(SOLVAPAY_AUTHORIZATION_HEADER).toBe('authorization')
  })
})
