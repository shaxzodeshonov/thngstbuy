import { useState } from 'react'
import type { Item } from '@/domain/types'
import * as Items from '@/domain/items'
import { formatCount, formatMoney } from '@/domain/format'
import { ItemRow } from './ItemRow'
import { AddBar } from './AddBar'

type ListPaneProps = {
  items: Item[]
  selectedId: string | null
  /** False when the server is unreachable — shown as a quiet dot, not an alarm. */
  live: boolean
  onSelect(id: string): void
  onToggle(id: string): void
  onAdd(name: string): void
  onShare(): void
}

export function ListPane({
  items,
  selectedId,
  live,
  onSelect,
  onToggle,
  onAdd,
  onShare,
}: ListPaneProps) {
  const [showBought, setShowBought] = useState(false)

  const pending = Items.pending(items)
  const bought = Items.bought(items)
  const total = Items.pendingTotal(items)

  return (
    <section className="list" aria-label="Things to buy">
      <header className="list__head">
        <h1 className="label list__title">Things to buy</h1>
        <div className="list__headRight">
          {!live && (
            <span
              className="list__offline"
              title="Can't reach the server — your changes are kept and will sync when it's back."
              aria-label="Offline"
            />
          )}
          <button type="button" className="label list__share" onClick={onShare}>
            Share
          </button>
          <span className="label list__count">{formatCount(pending.length)}</span>
        </div>
      </header>

      <div className="list__scroll">
        {pending.length === 0 && bought.length === 0 ? (
          <p className="list__empty">Nothing yet. Add the first thing below.</p>
        ) : (
          <ul className="list__items">
            {pending.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                selected={item.id === selectedId}
                onSelect={onSelect}
                onToggle={onToggle}
              />
            ))}
          </ul>
        )}

        {bought.length > 0 && (
          <div className="bought">
            <button
              type="button"
              className="label bought__toggle"
              aria-expanded={showBought}
              onClick={() => setShowBought((v) => !v)}
            >
              {formatCount(bought.length)} bought
              <span className="bought__caret" data-open={showBought} aria-hidden="true" />
            </button>

            {showBought && (
              <ul className="list__items">
                {bought.map((item) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    selected={item.id === selectedId}
                    onSelect={onSelect}
                    onToggle={onToggle}
                  />
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <footer className="list__foot">
        {Items.hasPricedPending(items) && <p className="list__total">{formatMoney(total)}</p>}
        <AddBar onAdd={onAdd} />
      </footer>
    </section>
  )
}
