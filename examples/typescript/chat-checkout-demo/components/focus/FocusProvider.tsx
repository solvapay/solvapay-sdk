import React, { createContext, useCallback, useContext, useMemo, useState } from 'react'

type FocusContextValue = {
  requestChatInputFocus: () => void
  focusSignal: number
}

const FocusContext = createContext<FocusContextValue | null>(null)

export const FocusProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [focusSignal, setFocusSignal] = useState(0)

  const requestChatInputFocus = useCallback(() => setFocusSignal(n => n + 1), [])

  const value = useMemo(
    () => ({ requestChatInputFocus, focusSignal }),
    [requestChatInputFocus, focusSignal],
  )

  return <FocusContext.Provider value={value}>{children}</FocusContext.Provider>
}

export const useFocusBus = () => {
  const ctx = useContext(FocusContext)
  if (!ctx) throw new Error('useFocusBus must be used within FocusProvider')
  return ctx
}
