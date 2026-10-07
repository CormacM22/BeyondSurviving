import type { EventbriteState } from './PublishPanel'

// The website post has the same shape of status as the Eventbrite copy, plus an
// informational note (e.g. "changed in WordPress, so left alone").
export type WebsiteState = EventbriteState & {
  note: string | null
  hasPost: boolean
  /** Its post was reused by a later event, so this event no longer changes it. */
  handedOver: boolean
}

type Props = {
  state: WebsiteState | null
  busy: boolean
  /** The post doesn't match the event (e.g. cancelled but still posted): offer to fix it. */
  outOfStep: boolean
  onRetry: () => void
  onClearCheck: () => void
}

const STATUS_TEXT: Record<WebsiteState['status'], string> = {
  not_started: 'Not posted yet',
  draft: 'Hidden draft (only you can see it)',
  live: 'Posted on the website',
  cancelled: 'Taken down',
}

export function WebsitePanel({ state, busy, outOfStep, onRetry, onClearCheck }: Props) {
  if (!state) return null

  return (
    <div className="step-card" aria-live="polite">
      <div className="row">
        <strong>Website</strong>
        <span className={`badge badge-${state.status}`}>{busy ? 'Sending…' : STATUS_TEXT[state.status]}</span>
      </div>

      {state.status === 'not_started' && !state.lastError && (
        <p className="muted">It’s posted automatically once the event is live on Eventbrite.</p>
      )}

      {state.url && state.status !== 'cancelled' && (
        <p>
          <a href={state.url} target="_blank" rel="noreferrer">Open on the website ↗</a>
          {state.status === 'draft' && <span className="muted"> (sign in to WordPress to preview the draft)</span>}
        </p>
      )}

      {state.note && !state.lastError && <p className="muted">{state.note}</p>}
      {state.lastError && <p className="error" role="alert">{state.lastError}</p>}

      {state.needsCheck ? (
        <>
          <p>
            Please sign in to WordPress and look in <strong>Events</strong> (drafts and published) for a copy of
            this event. If there is one, move it to the Bin first.
          </p>
          <button className="btn btn-secondary" disabled={busy} onClick={onClearCheck}>
            I’ve checked WordPress, try again
          </button>
        </>
      ) : (state.lastError || outOfStep) && !busy ? (
        <button className="btn btn-secondary" onClick={onRetry}>Update the website</button>
      ) : null}
    </div>
  )
}
