import { useSyncExternalStore } from 'react'

/**
 * Web-only. The React Native port swaps this for `useWindowDimensions()` —
 * every caller just wants the boolean.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query)
      mql.addEventListener('change', onChange)
      return () => mql.removeEventListener('change', onChange)
    },
    () => window.matchMedia(query).matches,
    () => false,
  )
}

/** The one breakpoint in the app: below it, one pane; above it, two. */
export const WIDE = '(min-width: 900px)'
