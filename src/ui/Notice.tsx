/** Full-card message for the states where there's no list to show. */
export function Notice({
  title,
  body,
  action,
}: {
  title: string
  body: string
  action: { label: string; onClick(): void }
}) {
  return (
    <div className="shell">
      <main className="card card--notice">
        <div className="notice">
          <h1 className="notice__title">{title}</h1>
          <p className="notice__body">{body}</p>
          <button type="button" className="label notice__action" onClick={action.onClick}>
            {action.label}
          </button>
        </div>
      </main>
    </div>
  )
}
