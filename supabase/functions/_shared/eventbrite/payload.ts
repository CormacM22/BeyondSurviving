// Turns an event from our database into what Eventbrite expects.
// Eventbrite gets the event's area (as its venue), matching how Ciara lists
// events today. The venue name and street address aren't sent.

import { formatHtml } from '../format.ts'
import type { Category, EventRecord } from './types.ts'

// Eventbrite category ids (GET /categories/).
const CATEGORY_IDS: Record<Category, string> = {
  support_group: '107', // Health
  community_event: '113', // Community
  fundraiser: '111', // Charity & Causes
}

/** Any timestamp → the UTC format Eventbrite accepts: YYYY-MM-DDTHH:MM:SSZ. */
export function toEventbriteUtc(timestamp: string): string {
  const normalised = timestamp.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00')
  const ms = Date.parse(normalised)
  if (Number.isNaN(ms)) throw new Error(`Not a timestamp: "${timestamp}"`)
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

/** The description as Eventbrite shows it: paragraphs, bullet points and bold (see format.ts). */
export function descriptionHtml(text: string): string {
  return formatHtml(text)
}

export type EventPayload = {
  name: { html: string }
  summary: string
  start: { timezone: string; utc: string }
  end: { timezone: string; utc: string }
  currency: 'EUR'
  online_event: boolean
  listed: boolean
  venue_id: string | null
  category_id: string
  capacity: number
}

export function eventPayload(ev: EventRecord, opts: { venueId: string | null; listed: boolean }): EventPayload {
  return {
    name: { html: escapeHtml(ev.title) },
    // Always sent, so clearing the summary here clears it on Eventbrite too.
    summary: ev.summary ?? '',
    start: { timezone: ev.timezone, utc: toEventbriteUtc(ev.starts_at) },
    end: { timezone: ev.timezone, utc: toEventbriteUtc(ev.ends_at) },
    currency: 'EUR',
    online_event: ev.is_online,
    listed: opts.listed,
    venue_id: ev.is_online ? null : opts.venueId,
    category_id: CATEGORY_IDS[ev.category],
    capacity: ev.capacity,
  }
}
