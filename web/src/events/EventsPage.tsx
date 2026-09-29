import { useState } from 'react'
import { EventList } from './EventList'
import { EventForm } from './EventForm'

type View = { screen: 'list' } | { screen: 'form'; eventId: string | null }

export function EventsPage() {
  const [view, setView] = useState<View>({ screen: 'list' })

  if (view.screen === 'form') {
    return <EventForm eventId={view.eventId} onDone={() => setView({ screen: 'list' })} />
  }
  return (
    <EventList
      onNew={() => setView({ screen: 'form', eventId: null })}
      onOpen={(id) => setView({ screen: 'form', eventId: id })}
    />
  )
}
