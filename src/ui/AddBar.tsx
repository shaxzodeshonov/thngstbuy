import { useState } from 'react'
import { Plus } from './icons'

type AddBarProps = {
  onAdd(name: string): void
}

/**
 * The bottom line of the list. Submitting keeps focus so several things can be
 * added in a row without reaching for the field again.
 */
export function AddBar({ onAdd }: AddBarProps) {
  const [name, setName] = useState('')
  const ready = name.trim().length > 0

  function submit() {
    if (!ready) return
    onAdd(name)
    setName('')
  }

  return (
    <form
      className="addBar"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <input
        className="addBar__input"
        value={name}
        placeholder="Add something"
        aria-label="Add something to the list"
        autoComplete="off"
        onChange={(e) => setName(e.target.value)}
      />
      <button
        type="submit"
        className="addBar__button"
        data-ready={ready}
        aria-label="Add to the list"
        disabled={!ready}
      >
        <Plus size={18} />
      </button>
    </form>
  )
}
