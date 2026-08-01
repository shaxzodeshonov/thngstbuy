import { useCallback, useEffect, useRef, useState } from 'react'
import * as Items from '@/domain/items'
import { api } from '@/data/api'
import { describe, useSyncedList } from '@/data/useSyncedList'
import { ListPane } from './ListPane'
import { DetailPane } from './DetailPane'
import { SummaryPane } from './SummaryPane'
import { ShareSheet } from './ShareSheet'
import { Notice } from './Notice'
import { useListRoute } from './useListRoute'
import { WIDE, useMediaQuery } from './useMediaQuery'
import '@/styles/app.css'

export function App() {
  const { listId, openList } = useListRoute()
  const [bootError, setBootError] = useState<string | null>(null)

  // Landing on `/` mints a list and swaps the URL for it, so the address bar is
  // always something you can send to someone.
  const creating = useRef(false)
  useEffect(() => {
    if (listId || creating.current) return
    creating.current = true

    api
      .createList()
      .then((state) => openList(state.slug, { replace: true }))
      .catch((failure: unknown) => setBootError(describe(failure)))
      .finally(() => {
        creating.current = false
      })
  }, [listId, openList])

  const list = useSyncedList(listId)
  const wide = useMediaQuery(WIDE)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [sharing, setSharing] = useState(false)
  const selected = list.items.find((i) => i.id === selectedId) ?? null

  // A rename changes the list's name under the URL that's showing. Replace it
  // rather than push, so Back doesn't lead to the name that no longer applies.
  useEffect(() => {
    if (list.slug && listId && list.slug !== listId) openList(list.slug, { replace: true })
  }, [list.slug, listId, openList])

  // Something deleted here or by someone else must not leave a dead pane.
  useEffect(() => {
    if (selectedId && !selected) setSelectedId(null)
  }, [selectedId, selected])

  const handleAdd = useCallback(
    (name: string) => {
      const item = list.add(name)
      // On two panes the new item opens straight away so its details can be
      // filled in. On one pane that would yank the user off the list.
      if (item && wide) setSelectedId(item.id)
    },
    [list, wide],
  )

  const handleDelete = useCallback(() => {
    if (!selected) return
    const next = wide ? Items.neighbourOf(list.items, selected.id) : null
    list.remove(selected.id)
    setSelectedId(next)
  }, [list, selected, wide])

  const handleToggleFromDetail = useCallback(() => {
    if (!selected) return
    list.toggleBought(selected.id)
    // Marking something bought on a phone means you're done with it — go back.
    // On two panes the pane stays put so the change is visible and undoable.
    if (!wide) setSelectedId(null)
  }, [list, selected, wide])

  // Escape closes whichever overlay is open.
  useEffect(() => {
    if (!selectedId && !sharing) return
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      const el = document.activeElement
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return
      setSelectedId(null)
      setSharing(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedId, sharing])

  const startFresh = useCallback(() => {
    api
      .createList()
      .then((state) => openList(state.slug))
      .catch((failure: unknown) => setBootError(describe(failure)))
  }, [openList])

  if (bootError || list.status === 'error') {
    return (
      <Notice
        title="Can't reach the list"
        body="The server answered with an error. If this is a fresh deploy, the database settings are the usual cause."
        detail={bootError ?? list.error}
        action={{ label: 'Try again', onClick: () => window.location.reload() }}
      />
    )
  }

  if (list.status === 'missing') {
    return (
      <Notice
        title="This list is gone"
        body="The link doesn't point at anything — it may have been mistyped, or the list was never created."
        action={{ label: 'Start a new list', onClick: startFresh }}
      />
    )
  }

  if (!listId || list.status === 'loading') return <div className="shell" />

  const detail = selected && (
    <DetailPane
      key={selected.id}
      item={selected}
      position={Items.positionOf(list.items, selected.id)}
      wide={wide}
      onBack={() => setSelectedId(null)}
      onChange={(patch) => list.update(selected.id, patch)}
      onToggleBought={handleToggleFromDetail}
      onDelete={handleDelete}
    />
  )

  const share = sharing && list.slug && (
    <ShareSheet slug={list.slug} onClose={() => setSharing(false)} onRename={list.rename} />
  )

  return (
    <div className="shell">
      <main className="card" data-layout={wide ? 'wide' : 'compact'}>
        <ListPane
          items={list.items}
          selectedId={wide ? selectedId : null}
          live={list.live}
          onSelect={(id) => {
            setSharing(false)
            setSelectedId(id)
          }}
          onToggle={list.toggleBought}
          onAdd={handleAdd}
          onShare={() => {
            setSelectedId(null)
            setSharing(true)
          }}
        />

        {wide ? (
          <div className="card__right">{share || detail || <SummaryPane items={list.items} />}</div>
        ) : (
          (share || detail) && <div className="card__overlay">{share || detail}</div>
        )}
      </main>
    </div>
  )
}
