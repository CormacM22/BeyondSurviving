import { useState } from 'react'

export type EventbriteState = {
  status: 'not_started' | 'draft' | 'live' | 'cancelled'
  url: string | null
  lastError: string | null
  needsCheck: boolean
}

type Props = {
  state: EventbriteState | null
  busy: boolean
  onRetry: () => void
  onPublish: () => void
  onClearCheck: () => void
}

const STATUS_TEXT: Record<EventbriteState['status'], string> = {
  not_started: 'Not sent yet',
  draft: 'Draft (only you can see it)',
  live: 'Live: people can register',
  cancelled: 'Cancelled',
}

export function PublishPanel({ state, busy, onRetry, onPublish, onClearCheck }: Props) {
  const [confirming, setConfirming] = useState(false)

  if (!state) return null

  return (
    <div className="panel" aria-live="polite">
      <div className="row">
        <strong>Eventbrite</strong>
        <span className={`badge badge-${state.status}`}>{busy ? 'Sending…' : STATUS_TEXT[state.status]}</span>
      </div>

      {state.url && (
        <p>
          <a href={state.url} target="_blank" rel="noreferrer">Open on Eventbrite ↗</a>
          {state.status === 'draft' && <span className="muted"> (sign in to Eventbrite to preview the draft)</span>}
        </p>
      )}

      {state.lastError && <p className="error" role="alert">{state.lastError}</p>}

      {state.needsCheck ? (
        <>
          <p>
            Please sign in to Eventbrite and look under <strong>Events → Drafts</strong> for a copy of this event.
            If there is one, delete it there first.
          </p>
          <button className="secondary" disabled={busy} onClick={onClearCheck}>
            I’ve checked Eventbrite, try again
          </button>
        </>
      ) : state.lastError && !busy ? (
        <button className="secondary" onClick={onRetry}>Try sending to Eventbrite again</button>
      ) : null}

      {state.status === 'draft' && !state.lastError && !state.needsCheck && (
        confirming ? (
          <div className="confirm">
            <p><strong>Publish this event on Eventbrite?</strong> It becomes public and people can register straight away.</p>
            <div className="row-start">
              <button disabled={busy} onClick={() => { setConfirming(false); onPublish() }}>Yes, publish it</button>
              <button className="secondary" disabled={busy} onClick={() => setConfirming(false)}>Not yet</button>
            </div>
          </div>
        ) : (
          <button disabled={busy} onClick={() => setConfirming(true)}>Publish on Eventbrite…</button>
        )
      )}
    </div>
  )
}
