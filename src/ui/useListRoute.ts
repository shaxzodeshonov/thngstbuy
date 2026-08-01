import { useCallback, useEffect, useState } from 'react'

/**
 * Routing is one shape — `/l/:id` — so it isn't worth a router.
 *
 * In React Native this becomes a deep link handler: the id arrives from
 * `Linking.getInitialURL()` instead of `location.pathname`.
 */

const PATH = /^\/l\/([0-9a-hjkmnp-tv-z]{12})\/?$/

function readId(): string | null {
  return PATH.exec(window.location.pathname)?.[1] ?? null
}

export function useListRoute() {
  const [listId, setListId] = useState<string | null>(readId)

  useEffect(() => {
    const onPop = () => setListId(readId())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const openList = useCallback((id: string, { replace = false } = {}) => {
    const url = `/l/${id}`
    if (replace) window.history.replaceState(null, '', url)
    else window.history.pushState(null, '', url)
    setListId(id)
  }, [])

  return { listId, openList }
}
