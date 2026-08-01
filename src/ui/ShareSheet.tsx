import { useEffect, useRef, useState } from 'react'
import { ChevronLeft } from './icons'

type ShareSheetProps = {
  slug: string
  onClose(): void
  onRename(next: string): Promise<string | null>
}

/**
 * The link, and the one place it can be renamed.
 *
 * Renaming is presented plainly rather than hidden: a chosen name is the one
 * setting here with a real consequence, because it trades away the only thing
 * keeping a list private.
 */
export function ShareSheet({ slug, onClose, onRename }: ShareSheetProps) {
  const [draft, setDraft] = useState(slug)
  const [problem, setProblem] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState(false)

  const input = useRef<HTMLInputElement>(null)
  const url = `${window.location.origin}/l/${slug}`
  const changed = draft.trim().toLowerCase() !== slug

  useEffect(() => setDraft(slug), [slug])

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1800)
    return () => clearTimeout(timer)
  }, [copied])

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
    } catch {
      input.current?.focus()
      setProblem('Copying was blocked. Select the link above and copy it by hand.')
    }
  }

  async function save() {
    const next = draft.trim().toLowerCase()
    if (!changed || saving) return

    setSaving(true)
    setProblem(await onRename(next))
    setSaving(false)
  }

  return (
    <section className="share" aria-label="Share this list">
      <header className="share__head">
        <button type="button" className="detail__back" onClick={onClose} aria-label="Back to the list">
          <ChevronLeft />
        </button>
      </header>

      <div className="share__body">
        <h1 className="share__title">Share this list</h1>
        <p className="share__lead">
          Anyone with this link can add, edit and delete things. There is no password.
        </p>

        <p className="share__url">{url}</p>

        <button type="button" className="label share__copy" onClick={copy} data-copied={copied}>
          {copied ? 'Link copied' : 'Copy link'}
        </button>

        <div className="share__rename">
          <label className="field__label" htmlFor="share-slug">
            Custom name
          </label>

          <div className="share__input">
            <span className="share__prefix">/l/</span>
            <input
              id="share-slug"
              ref={input}
              className="share__field"
              value={draft}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="shaxzod"
              onChange={(e) => {
                setDraft(e.target.value)
                setProblem(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void save()
              }}
            />
          </div>

          <p className="share__note">
            A name like <em>shaxzod</em> is easy to remember — and easy for anyone else to guess.
            Leave the generated one if this list should stay private.
          </p>

          {problem && <p className="share__problem">{problem}</p>}

          <button
            type="button"
            className="label share__save"
            onClick={save}
            disabled={!changed || saving}
          >
            {saving ? 'Saving' : 'Save name'}
          </button>
        </div>
      </div>
    </section>
  )
}
