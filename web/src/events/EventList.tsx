import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { utcToDublinLocal } from '../lib/dublinTime'

type ListRow = {
  id: string
  title: string
  starts_at: string
  is_online: boolean
  public_area: string | null
  status: 'draft' | 'published' | 'cancelled'
}

const STATUS_LABEL: Record<ListRow['status'], string> = {
  draft: 'Draft',
  published: 'Published',
  cancelled: 'Cancelled',
}

function formatDublin(utc: string): string {
  const [date, time] = utcToDublinLocal(utc).split('T')
  const [y, m, d] = date.split('-').map(Number)
  const day = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IE', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  })
  return `${day}, ${time}`
}

export function EventList({ onNew, onOpen }: { onNew: () => void; onOpen: (id: string) => void }) {
  const [events, setEvents] = useState<ListRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase
      .from('events')
      .select('id, title, starts_at, is_online, public_area, status')
      .order('starts_at', { ascending: true })
      .then(({ data, error }) => {
        if (error) setError('Couldn’t load events. Please refresh and try again.')
        else setEvents(data as ListRow[])
      })
  }, [])

  return (
    <section>
      <div className="row">
        <h2>Events</h2>
        <button onClick={onNew}>New event</button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {events && events.length === 0 && <p className="muted">No events yet.</p>}
      {events && events.length > 0 && (
        <ul className="event-list">
          {events.map((e) => (
            <li key={e.id}>
              <button className="event-item" onClick={() => onOpen(e.id)}>
                <span className="event-title">{e.title}</span>
                <span className="muted">
                  {formatDublin(e.starts_at)} · {e.is_online ? 'Online' : e.public_area}
                </span>
                <span className={`badge badge-${e.status}`}>{STATUS_LABEL[e.status]}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
