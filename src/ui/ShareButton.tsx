import { useEffect, useState } from 'react'

/**
 * The link is the whole access model, so copying it has to be one tap.
 * Sits in the list header in the same tracked uppercase as the section label.
 */
export function ShareButton() {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1800)
    return () => clearTimeout(timer)
  }, [copied])

  async function copy() {
    const url = window.location.href
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
    } catch {
      // Clipboard API needs a secure context; fall back to a scratch selection.
      setCopied(legacyCopy(url))
    }
  }

  return (
    <button type="button" className="label list__share" onClick={copy} data-copied={copied}>
      {copied ? 'Link copied' : 'Share'}
    </button>
  )
}

function legacyCopy(text: string): boolean {
  const field = document.createElement('textarea')
  field.value = text
  field.setAttribute('readonly', '')
  field.style.position = 'fixed'
  field.style.opacity = '0'
  document.body.appendChild(field)
  field.select()

  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  document.body.removeChild(field)
  return ok
}
