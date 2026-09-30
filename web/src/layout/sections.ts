import type { ComponentType } from 'react'
import { EventsPage } from '../events/EventsPage'

// The dashboard's sections, in sidebar order. To add a page for another of
// Ciara's jobs: add an entry here (and a permission for it in the database, so
// it can be given to some users and not others, e.g. a board member).
export type Section = {
  id: string
  label: string
  /** One line, shown under the page title. */
  summary: string
  /** Users need this permission (see public.permissions) to see the section. */
  permission: string
  Page: ComponentType<{ parts: string[] }>
}

export const SECTIONS: Section[] = [
  {
    id: 'events',
    label: 'Events',
    summary: 'Write an event once. It goes to Eventbrite and the website’s Events page.',
    permission: 'events.manage',
    Page: EventsPage,
  },
]
