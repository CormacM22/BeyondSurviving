import { navigate } from '../lib/route'
import { EventList } from './EventList'
import { EventForm } from './EventForm'

// #/events → the list, #/events/new → a new event, #/events/copy/<id> → a new
// event copied from <id>, #/events/<id> → that event.
export function EventsPage({ parts }: { parts: string[] }) {
  const [id, copyFrom] = parts
  if (!id) return <EventList onNew={() => navigate('/events/new')} onOpen={(eventId) => navigate(`/events/${eventId}`)} />
  return (
    <EventForm
      key={parts.join('/')}
      eventId={id === 'new' || id === 'copy' ? null : id}
      copyFrom={id === 'copy' ? copyFrom : undefined}
      onCopy={(eventId) => navigate(`/events/copy/${eventId}`)}
      onDone={() => navigate('/events')}
      // A new event gets its own address once saved, without reloading the page.
      onCreated={(eventId) => history.replaceState(null, '', `#/events/${eventId}`)}
    />
  )
}
