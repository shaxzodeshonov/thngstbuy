import { useEffect, useState } from 'react'
import type { Item } from '@/domain/types'
import { formatCount, formatDate } from '@/domain/format'
import { Field, PriceField, StaticField } from './Field'
import { Check, ChevronLeft, Trash } from './icons'

type DetailPaneProps = {
  item: Item
  /** 1-based position, shown in the corner. */
  position: number
  /** Two-pane layout — hides the back control and labels the actions. */
  wide: boolean
  onBack(): void
  onChange(patch: Partial<Item>): void
  onToggleBought(): void
  onDelete(): void
}

export function DetailPane({
  item,
  position,
  wide,
  onBack,
  onChange,
  onToggleBought,
  onDelete,
}: DetailPaneProps) {
  const armed = useArmedDelete(item.id)

  return (
    <section className="detail" aria-label={item.name}>
      <header className="detail__head">
        {wide ? (
          <span />
        ) : (
          <button type="button" className="detail__back" onClick={onBack} aria-label="Back to the list">
            <ChevronLeft />
          </button>
        )}
        <span className="label detail__count">{formatCount(position)}</span>
      </header>

      <div className="detail__scroll">
        <TitleInput name={item.name} onChange={(name) => onChange({ name })} />

        <PriceField value={item.price} onCommit={(price) => onChange({ price })} />

        <div className="detail__fields">
          <Field
            label="Which model"
            value={item.model}
            placeholder="Not decided yet"
            onChange={(model) => onChange({ model })}
          />
          <Field
            label="Where"
            value={item.where}
            placeholder="Not sure yet"
            onChange={(where) => onChange({ where })}
          />
          <Field
            label="Why"
            value={item.why}
            placeholder="What is this for?"
            multiline
            onChange={(why) => onChange({ why })}
          />
          <StaticField label="Added" value={formatDate(item.addedAt)} />
        </div>
      </div>

      <footer className="detail__foot" data-wide={wide}>
        <button
          type="button"
          className="action"
          data-active={item.bought}
          onClick={onToggleBought}
          aria-pressed={item.bought}
          aria-label={item.bought ? `Mark ${item.name} as not bought` : `Mark ${item.name} as bought`}
        >
          <span className="action__icon">
            <Check size={18} />
          </span>
          {wide && <span className="label action__label">{item.bought ? 'Bought' : 'Mark bought'}</span>}
        </button>

        <button
          type="button"
          className="action action--danger"
          data-armed={armed.isArmed}
          onClick={() => (armed.isArmed ? onDelete() : armed.arm())}
          aria-label={armed.isArmed ? `Confirm removing ${item.name}` : `Remove ${item.name}`}
        >
          <span className="action__icon">
            <Trash size={18} />
          </span>
          {wide && <span className="label action__label">{armed.isArmed ? 'Tap again' : 'Remove'}</span>}
        </button>
      </footer>
    </section>
  )
}

/** Same focus-owns-the-text rule as the fields below it. */
function TitleInput({ name, onChange }: { name: string; onChange(value: string): void }) {
  const [draft, setDraft] = useState<string | null>(null)

  return (
    <input
      className="detail__title"
      value={draft ?? name}
      placeholder="Untitled"
      aria-label="Name"
      autoComplete="off"
      onFocus={() => setDraft(name)}
      onBlur={() => setDraft(null)}
      onChange={(e) => {
        setDraft(e.target.value)
        onChange(e.target.value)
      }}
    />
  )
}

/**
 * Delete takes two taps instead of a dialog: the first arms the button, the
 * second commits. Disarms on its own so a stray tap can't linger, and resets
 * whenever a different item is shown.
 */
function useArmedDelete(itemId: string) {
  const [isArmed, setIsArmed] = useState(false)

  useEffect(() => setIsArmed(false), [itemId])

  useEffect(() => {
    if (!isArmed) return
    const timer = setTimeout(() => setIsArmed(false), 3500)
    return () => clearTimeout(timer)
  }, [isArmed])

  return { isArmed, arm: () => setIsArmed(true) }
}
