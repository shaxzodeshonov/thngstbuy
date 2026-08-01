import { useEffect, useId, useRef, useState } from 'react'
import { formatMoney, parsePrice } from '@/domain/format'

/**
 * A labelled line in the detail pane. Looks like plain text until you click it —
 * the input has no chrome of its own, so the pane reads as a written note
 * rather than a form.
 */

type FieldProps = {
  label: string
  value: string
  placeholder: string
  multiline?: boolean
  onChange(value: string): void
}

export function Field({ label, value, placeholder, multiline, onChange }: FieldProps) {
  const id = useId()
  const draft = useDraft(value, onChange)

  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      {multiline ? (
        <AutoTextarea id={id} placeholder={placeholder} {...draft} />
      ) : (
        <input
          id={id}
          className="field__value"
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          {...draft}
        />
      )}
    </div>
  )
}

/**
 * While a field has focus it owns its text. Someone else editing the same list
 * pushes a new snapshot every few hundred milliseconds, and adopting it
 * mid-word would move the caret out from under the person typing.
 */
function useDraft(value: string, onChange: (value: string) => void) {
  const [draft, setDraft] = useState<string | null>(null)

  return {
    value: draft ?? value,
    onFocus: () => setDraft(value),
    onBlur: () => setDraft(null),
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setDraft(e.target.value)
      onChange(e.target.value)
    },
  }
}

/** Read-only counterpart, for values the app owns (e.g. the added date). */
export function StaticField({ label, value }: { label: string; value: string }) {
  return (
    <div className="field">
      <span className="field__label">{label}</span>
      <span className="field__value field__value--static">{value}</span>
    </div>
  )
}

type AutoTextareaProps = {
  id: string
  placeholder: string
  value: string
  onFocus(): void
  onBlur(): void
  onChange(e: React.ChangeEvent<HTMLTextAreaElement>): void
}

/** Grows with its content so the pane never gets an inner scrollbar. */
function AutoTextarea({ id, placeholder, value, ...handlers }: AutoTextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value])

  return (
    <textarea
      id={id}
      ref={ref}
      className="field__value"
      rows={1}
      value={value}
      placeholder={placeholder}
      spellCheck={false}
      {...handlers}
    />
  )
}

/**
 * Price gets its own field: while you type it holds raw text, and only on blur
 * does it parse and hand back a number. Otherwise the digit grouping fights
 * the cursor on every keystroke.
 */
type PriceFieldProps = {
  value: number | null
  onCommit(value: number | null): void
}

export function PriceField({ value, onCommit }: PriceFieldProps) {
  const [draft, setDraft] = useState<string | null>(null)
  const display = draft ?? (value === null ? '' : formatMoney(value))

  return (
    <input
      className="detail__price"
      value={display}
      placeholder="Add a price"
      inputMode="numeric"
      aria-label="Price in UZS"
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => setDraft(value === null ? '' : String(value))}
      onBlur={(e) => {
        onCommit(parsePrice(e.target.value))
        setDraft(null)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') {
          setDraft(null)
          e.currentTarget.blur()
        }
      }}
    />
  )
}
