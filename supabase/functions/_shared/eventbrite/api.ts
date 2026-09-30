// The real Eventbrite API. Each call here was confirmed by hand on the test
// account first: see knowledge/build/eventbrite-api.md (kept outside the repo).

import { EventbriteError } from './types.ts'
import type { EventbriteApi } from './types.ts'

const BASE = 'https://www.eventbriteapi.com/v3'
// Each call gives up after this long, keeping a whole save well inside the
// 5-minute lock window. A timeout counts as "unclear": see sync.ts.
const TIMEOUT_MS = 20_000

export function eventbriteApi(token: string, organizationId: string): EventbriteApi {
  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(BASE + path, {
      method,
      // Only send a JSON content type with a JSON body: on a GET, Eventbrite then
      // reads arguments from the (empty) body and ignores the query string.
      headers: body === undefined
        ? { Authorization: `Bearer ${token}` }
        : { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const text = await res.text()
    if (!res.ok) {
      let detail = text.slice(0, 300)
      try {
        const j = JSON.parse(text)
        detail = j.error_description ?? j.error ?? detail
      } catch { /* keep raw text */ }
      throw new EventbriteError(res.status, detail)
    }
    return (text ? JSON.parse(text) : {}) as T
  }

  return {
    async createVenue(area) {
      const v = await call<{ id: string }>('POST', `/organizations/${organizationId}/venues/`, {
        venue: { name: area, address: { city: area, country: 'IE' } },
      })
      return v.id
    },

    async createEvent(payload) {
      const e = await call<{ id?: unknown; url?: unknown }>('POST', `/organizations/${organizationId}/events/`, { event: payload })
      // A plain Error (not EventbriteError) counts as "unclear": the event may exist.
      if (typeof e.id !== 'string' || !e.id) throw new Error('Eventbrite replied without an event id')
      return { id: e.id, url: typeof e.url === 'string' ? e.url : '' }
    },

    async updateEvent(eventId, payload) {
      await call('POST', `/events/${eventId}/`, { event: payload })
    },

    async listTicketClassIds(eventId) {
      const r = await call<{ ticket_classes?: { id: string }[] }>('GET', `/events/${eventId}/ticket_classes/`)
      return (r.ticket_classes ?? []).map((t) => t.id)
    },

    async createFreeTicket(eventId, quantity) {
      const t = await call<{ id: string }>('POST', `/events/${eventId}/ticket_classes/`, {
        ticket_class: { name: 'Free registration', free: true, quantity_total: quantity },
      })
      return t.id
    },

    async updateTicketQuantity(eventId, ticketClassId, quantity) {
      await call('POST', `/events/${eventId}/ticket_classes/${ticketClassId}/`, {
        ticket_class: { quantity_total: quantity },
      })
    },

    async setDescription(eventId, html) {
      const current = await call<{ page_version_number?: string }>('GET', `/events/${eventId}/structured_content/`)
      const next = Number(current.page_version_number ?? 0) + 1
      await call('POST', `/events/${eventId}/structured_content/${next}/`, {
        modules: [{ type: 'text', data: { body: { type: 'text', text: html, alignment: 'left' } } }],
        publish: true,
        purpose: 'listing',
      })
    },

    async uploadLogo({ bytes, contentType }) {
      const ticket = await call<{
        upload_url: string
        upload_data: Record<string, string>
        file_parameter_name: string
        upload_token: string
      }>('GET', '/media/upload/?type=image-event-logo')

      const form = new FormData()
      for (const [k, v] of Object.entries(ticket.upload_data)) form.append(k, v)
      form.append(ticket.file_parameter_name, new Blob([new Uint8Array(bytes)], { type: contentType }), 'cover')
      const up = await fetch(ticket.upload_url, { method: 'POST', body: form, signal: AbortSignal.timeout(60_000) })
      if (!up.ok) throw new EventbriteError(up.status, 'the cover image upload failed')

      const image = await call<{ id: string }>('POST', '/media/upload/', { upload_token: ticket.upload_token })
      return image.id
    },

    async publish(eventId) {
      const r = await call<{ published?: boolean }>('POST', `/events/${eventId}/publish/`)
      if (r.published === false) throw new EventbriteError(400, 'the event was not published')
    },

    async getEventStatus(eventId) {
      const e = await call<{ status: string }>('GET', `/events/${eventId}/`)
      return e.status
    },
  }
}
