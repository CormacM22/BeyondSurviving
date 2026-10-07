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
  onCancel: () => void
  onClearCheck: () => void
  /** Cancelling will also hide this event's website post. */
  hidesWebsitePost?: boolean
}

const STATUS_TEXT: Record<EventbriteState['status'], string> = {
  not_started: 'Not sent yet',
  draft: 'Draft (only you can see it)',
  live: 'Live: people can register',
  cancelled: 'Cancelled',
}

export function PublishPanel({ state, busy, onRetry, onPublish, onCancel, onClearCheck, hidesWebsitePost }: Props) {
  const [confirming, setConfirming] = useState(false)
  const [confirmingCancel, setConfirmingCancel] = useState(false)

  if (!state) return null

  return (
    <div className="step-card" aria-live="polite">
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
          <button className="btn btn-secondary" disabled={busy} onClick={onClearCheck}>
            I’ve checked Eventbrite, try again
          </button>
        </>
      ) : state.lastError && !busy && state.status !== 'cancelled' ? (
        <button className="btn btn-secondary" onClick={onRetry}>Try sending to Eventbrite again</button>
      ) : null}

      {state.status === 'draft' && !state.lastError && !state.needsCheck && (
        confirming ? (
          <div className="confirm">
            <p><strong>Publish this event on Eventbrite?</strong> It becomes public and people can register straight away.</p>
            <div className="row-start">
              <button className="btn btn-primary" disabled={busy} onClick={() => { setConfirming(false); onPublish() }}>Yes, publish it</button>
              <button className="btn btn-secondary" disabled={busy} onClick={() => setConfirming(false)}>Not yet</button>
            </div>
          </div>
        ) : (
          <button className="btn btn-primary" disabled={busy} onClick={() => setConfirming(true)}>Publish on Eventbrite…</button>
        )
      )}

      {state.status !== 'cancelled' && !state.needsCheck && (
        confirmingCancel ? (
          <div className="confirm confirm-danger">
            <p>
              <strong>Cancel this event?</strong>{' '}
              {state.status === 'not_started'
                ? 'It hasn’t been sent to Eventbrite, so it’s only cancelled here.'
                : 'It’s cancelled on Eventbrite straight away.'}{' '}
              <strong>This can’t be undone.</strong>
            </p>
            {hidesWebsitePost && (
              <p>Its post on the website will be hidden, until another session uses it.</p>
            )}
            {state.status === 'live' && (
              <p>
                If anyone has registered, Eventbrite only allows cancelling on Eventbrite itself, after refunding
                every registration. The dashboard will explain. It doesn’t contact people who’ve registered.
              </p>
            )}
            <div className="row-start">
              <button className="btn btn-danger" disabled={busy} onClick={() => { setConfirmingCancel(false); onCancel() }}>
                Yes, cancel the event
              </button>
              <button className="btn btn-secondary" disabled={busy} onClick={() => setConfirmingCancel(false)}>Keep it</button>
            </div>
          </div>
        ) : (
          <button className="btn-link danger-link" disabled={busy} onClick={() => setConfirmingCancel(true)}>Cancel event…</button>
        )
      )}
    </div>
  )
}
