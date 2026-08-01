import type { Item } from '@/domain/types'
import * as Items from '@/domain/items'
import { daysSince, formatMoney, pluralise } from '@/domain/format'

/**
 * Wide-screen only. The right pane always has something to say, so an
 * unselected list doesn't leave half the window blank — it reads as a standing
 * summary that the detail view temporarily replaces.
 */
export function SummaryPane({ items }: { items: Item[] }) {
  const pending = Items.pending(items)
  const bought = Items.bought(items)
  const total = Items.pendingTotal(items)
  const unpriced = pending.filter((i) => i.price === null).length
  const waiting = oldest(pending)

  if (pending.length === 0 && bought.length === 0) {
    return (
      <section className="summary summary--empty" aria-label="Summary">
        <p className="summary__hint">
          Nothing on the list yet.
          <br />
          Add the first thing on the left.
        </p>
      </section>
    )
  }

  return (
    <section className="summary" aria-label="Summary">
      <p className="label summary__label">Still to buy</p>
      <p className="summary__total">{total > 0 ? formatMoney(total) : 'Nothing priced yet'}</p>

      <dl className="summary__stats">
        <Stat label="On the list" value={pluralise(pending.length, 'thing')} />
        {unpriced > 0 && <Stat label="Without a price" value={pluralise(unpriced, 'thing')} />}
        {bought.length > 0 && <Stat label="Already bought" value={pluralise(bought.length, 'thing')} />}
        {waiting && (
          <Stat
            label="Waiting longest"
            value={waiting.name}
            note={pluralise(daysSince(waiting.addedAt), 'day')}
          />
        )}
      </dl>

      <p className="summary__hint">Pick something on the left to open it.</p>
    </section>
  )
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="stat">
      <dt className="label stat__label">{label}</dt>
      <dd className="stat__value">
        {value}
        {note && <span className="stat__note">{note}</span>}
      </dd>
    </div>
  )
}

function oldest(items: Item[]): Item | null {
  if (items.length === 0) return null
  return items.reduce((a, b) => (a.addedAt <= b.addedAt ? a : b))
}
