import { useCallback, useEffect, useState } from 'react'

/**
 * Routing is one shape — `/l/:id` — so it isn't worth a router.
 *
 * In React Native this becomes a deep link handler: the id arrives from
 * `Linking.getInitialURL()` instead of `location.pathname`.
 */

/**
 * Matches both shapes a list can be named by: the 12-character generated id and
 * a chosen name like `shaxzod`. The server is the authority on what's valid;
 * this only has to be loose enough to let a real name through.
 */
const PATH = /^\/l\/([a-z0-9][a-z0-9-]{1,30}[a-z0-9])\/?$/

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
