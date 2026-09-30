import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { utcToDublinLocal } from '../lib/dublinTime'
import { PageHeader } from '../layout/AppShell'

type PublicationStatus = 'not_started' | 'draft' | 'live' | 'cancelled'

type ListRow = {
  id: string
  title: string
  starts_at: string
  is_online: boolean
  public_area: string | null
  status: 'draft' | 'published' | 'cancelled'
  event_publications: { target: 'eventbrite' | 'wordpress'; status: PublicationStatus }[]
}

const PUBLICATION_TEXT: Record<PublicationStatus, string> = {
  not_started: 'Not yet',
  draft: 'Draft',
  live: 'Live',
  cancelled: 'Cancelled',
}

/** Irish date parts for the date block, e.g. { day: '1', month: 'Oct', weekday: 'Thu', time: '18:30' }. */
function dublinDate(utc: string) {
  const [date, time] = utcToDublinLocal(utc).split('T')
  const [y, m, d] = date.split('-').map(Number)
  const at = new Date(Date.UTC(y, m - 1, d))
  const part = (o: Intl.DateTimeFormatOptions) => at.toLocaleDateString('en-IE', { ...o, timeZone: 'UTC' })
  return { day: String(d), month: part({ month: 'short' }), weekday: part({ weekday: 'short' }), year: y, time }
}

// Dates in the current year leave the year out.
const THIS_YEAR = new Date().getFullYear()

export function EventList({ onNew, onOpen }: { onNew: () => void; onOpen: (id: string) => void }) {
  const [events, setEvents] = useState<ListRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase
      .from('events')
      .select('id, title, starts_at, is_online, public_area, status, event_publications(target, status)')
      .order('starts_at', { ascending: true })
      .then(({ data, error }) => {
        if (error) setError('Events couldn’t be loaded. Refresh the page to try again.')
        else setEvents(data as ListRow[])
      })
  }, [])

  return (
    <>
      <div className="page-header-row">
        <PageHeader title="Events" summary="Write an event once. It goes to Eventbrite and the website’s Events page." />
        <button className="btn btn-primary" onClick={onNew}>New event</button>
      </div>

      {error && <p className="error" role="alert">{error}</p>}

      {events && events.length === 0 && (
        <div className="empty">
          <p className="empty-title">No events yet</p>
          <p>Add your first event and it can go out to Eventbrite and the website from here.</p>
          <button className="btn btn-primary" onClick={onNew}>New event</button>
        </div>
      )}

      {events && events.length > 0 && (
        <ul className="event-list">
          {events.map((e) => {
            const when = dublinDate(e.starts_at)
            const pub = (target: 'eventbrite' | 'wordpress') =>
              e.event_publications.find((p) => p.target === target)?.status ?? 'not_started'
            return (
              <li key={e.id}>
                <button className="event-row" data-status={e.status} onClick={() => onOpen(e.id)}>
                  <span className="date-block" aria-hidden="true">
                    <span className="date-month">{when.month}</span>
                    <span className="date-day">{when.day}</span>
                  </span>
                  <span className="event-row-main">
                    <span className="event-row-title">{e.title}</span>
                    <span className="event-row-meta">
                      {when.weekday} {when.day} {when.month}{when.year !== THIS_YEAR ? ` ${when.year}` : ''}, {when.time}
                      {' · '}
                      {e.is_online ? 'Online' : e.public_area}
                    </span>
                  </span>
                  <span className="event-row-status">
                    {e.status === 'cancelled' ? (
                      <span className="chip chip-cancelled">Cancelled</span>
                    ) : (
                      <>
                        <span className={`chip chip-${pub('eventbrite')}`}>Eventbrite: {PUBLICATION_TEXT[pub('eventbrite')]}</span>
                        <span className={`chip chip-${pub('wordpress')}`}>Website: {PUBLICATION_TEXT[pub('wordpress')]}</span>
                      </>
                    )}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}
