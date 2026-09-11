'use client'
import React, { createContext, useContext, useMemo } from 'react'
import { enCopy } from './en'
import { mergeCopy } from './merge'
import type { PartialSolvaPayCopy, SolvaPayCopy } from './types'

export type CopyContextValue = {
  locale?: string
  copy: SolvaPayCopy
}

export const CopyContext = createContext<CopyContextValue>({
  locale: undefined,
  copy: enCopy,
})

export type CopyProviderProps = {
  locale?: string
  copy?: PartialSolvaPayCopy
  children: React.ReactNode
}

export const CopyProvider: React.FC<CopyProviderProps> = ({
  locale,
  copy: overrides,
  children,
}) => {
  const value = useMemo<CopyContextValue>(
    () => ({
      locale,
      copy: mergeCopy(enCopy, overrides),
    }),
    [locale, overrides],
  )
  return <CopyContext.Provider value={value}>{children}</CopyContext.Provider>
}

export function useCopyContext(): CopyContextValue {
  return useContext(CopyContext)
}
