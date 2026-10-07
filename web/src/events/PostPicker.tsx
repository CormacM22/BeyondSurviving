import { useEffect, useState } from 'react'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

type PostSummary = {
  id: string
  title: string
  status: string
  eventDate: string | null
  location: string
  editable: boolean
}

/** "20261019" → "19 Oct 2026". */
function niceDate(ymd: string): string {
  const d = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8)))
  return d.toLocaleDateString('en-IE', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

/** Today in Ireland, as Ymd, to tell past sessions from upcoming ones. */
function todayYmd(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Dublin' }).format(new Date()).replaceAll('-', '')
}

type Props = {
  value: string
  onChange: (postId: string) => void
  disabled: boolean
  error?: string
}

/** Choose one of the website's existing Events posts to update for this event. */
export function PostPicker({ value, onChange, disabled, error }: Props) {
  const [posts, setPosts] = useState<PostSummary[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    supabase.functions.invoke('eventbrite', { body: { action: 'list_posts' } }).then(async ({ data, error }) => {
      if (error) {
        const body = error instanceof FunctionsHttpError ? await error.context.json().catch(() => null) : null
        setLoadError(body?.message ?? 'The website’s posts couldn’t be loaded. Refresh the page to try again.')
      } else {
        setPosts(data.posts as PostSummary[])
      }
    })
  }, [])

  if (loadError) return <p className="error">{loadError}</p>
  if (!posts) return <p className="muted">Loading the website’s posts…</p>

  const today = todayYmd()
  const sorted = [...posts].sort((a, b) => a.title.localeCompare(b.title) || (a.eventDate ?? '').localeCompare(b.eventDate ?? ''))
  const chosen = posts.find((p) => p.id === value)
  const label = (p: PostSummary) =>
    [
      p.title,
      p.eventDate ? `${p.eventDate < today ? 'last used for' : 'currently'} ${niceDate(p.eventDate)}` : 'no date',
      p.location,
    ].filter(Boolean).join(' · ') + (p.status !== 'publish' ? ' (hidden)' : '')

  return (
    <div className="field">
      <label className="field">
        <span>Post to update</span>
        <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
          <option value="">Choose a post…</option>
          {sorted.map((p) => <option key={p.id} value={p.id}>{label(p)}</option>)}
        </select>
      </label>
      <small className="hint">
        Pick a post whose session has passed. Its text, date, time, location and “register here” link are replaced with this event’s.
      </small>
      {error && <small className="error">{error}</small>}
      {chosen && chosen.eventDate && chosen.eventDate >= today && !disabled && (
        <p className="warning">
          This post currently shows a session on {niceDate(chosen.eventDate)} that hasn’t happened yet.
          Using it for this event will replace that session on the website.
        </p>
      )}
      {chosen && !chosen.editable && !disabled && (
        <p className="warning">
          Before the dashboard can update this post, set its Author to Events Dashboard in WordPress
          (Events → the post → Author).
        </p>
      )}
    </div>
  )
}
