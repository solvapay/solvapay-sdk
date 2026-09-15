import { renderHook } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import React from 'react'
import { useCopy, useLocale } from './useCopy'
import { CopyProvider } from '../i18n/context'
import { enCopy } from '../i18n/en'

describe('useCopy', () => {
  it('returns defaults outside a CopyProvider', () => {
    const { result } = renderHook(() => useCopy())
    expect(result.current.cta.payNow).toBe(enCopy.cta.payNow)
  })

  it('returns the merged bundle inside a CopyProvider', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <CopyProvider copy={{ cta: { payNow: 'Betala nu' } }}>{children}</CopyProvider>
    )
    const { result } = renderHook(() => useCopy(), { wrapper })
    expect(result.current.cta.payNow).toBe('Betala nu')
    expect(result.current.cta.subscribe).toBe(enCopy.cta.subscribe)
  })
})

describe('useLocale', () => {
  it('returns undefined outside a CopyProvider', () => {
    const { result } = renderHook(() => useLocale())
    expect(result.current).toBeUndefined()
  })

  it('returns the configured locale', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <CopyProvider locale="sv-SE">{children}</CopyProvider>
    )
    const { result } = renderHook(() => useLocale(), { wrapper })
    expect(result.current).toBe('sv-SE')
  })
})
