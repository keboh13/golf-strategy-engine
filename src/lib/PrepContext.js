import { createContext, useContext } from 'react'

export const PrepContext = createContext(null)

export function usePrepContext() {
  const ctx = useContext(PrepContext)
  if (!ctx) throw new Error('usePrepContext must be used within PrepContext.Provider')
  return ctx
}
