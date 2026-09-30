// Database side of publishing, for one event and one destination.
// Uses the service-role client: row-level security doesn't let the app write
// publication records, only these server-side functions.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import type { Claim, EventRecord, Meta, PublicationStatus, PublicationStore } from './types.ts'

const COVER_BUCKET = 'event-covers'

export function publicationStore(
  db: SupabaseClient,
  eventId: string,
  target: 'eventbrite' | 'wordpress',
): PublicationStore {
  async function update(values: Record<string, unknown>) {
    const { error } = await db.from('event_publications').update(values).eq('event_id', eventId).eq('target', target)
    if (error) throw new Error(`Database update failed: ${error.message}`)
  }

  return {
    async claim(): Promise<Claim> {
      const { data, error } = await db.rpc('claim_publication', { p_event_id: eventId, p_target: target }).single()
      if (error) throw new Error(`Couldn’t lock the event: ${error.message}`)
      const r = data as { outcome: string; external_id: string | null; external_url: string | null; status: PublicationStatus; meta: Meta }
      if (r.outcome === 'busy') return 'busy'
      if (r.outcome === 'needs_check') return 'needs_check'
      return { externalId: r.external_id, url: r.external_url, status: r.status, meta: r.meta ?? {} }
    },

    async loadEvent() {
      const { data, error } = await db.from('events').select('*').eq('id', eventId).single()
      if (error || !data) throw new Error(`Couldn’t read the event: ${error?.message}`)
      return data as EventRecord
    },

    async recordCreated(externalId, url) {
      await update({ external_id: externalId, external_url: url })
    },

    async saveMeta(meta) {
      await update({ meta })
    },

    async succeed(status, meta) {
      await update({ status, meta, last_error: null, in_progress_since: null, needs_check: false })
    },

    async fail(message, { needsCheck, meta }) {
      await update({
        last_error: message,
        ...(meta ? { meta } : {}),
        // Needs a check: keep the lock and flag the row until a person confirms.
        ...(needsCheck ? { needs_check: true } : { in_progress_since: null }),
      })
    },

    async loadCover(path) {
      const { data, error } = await db.storage.from(COVER_BUCKET).download(path)
      if (error || !data) throw new Error('Couldn’t read the cover image')
      return { bytes: new Uint8Array(await data.arrayBuffer()), contentType: data.type || 'image/jpeg' }
    },

    async markEventPublished() {
      // Never turns a cancelled event back into a published one.
      const { error } = await db.from('events').update({ status: 'published' }).eq('id', eventId).neq('status', 'cancelled')
      if (error) throw new Error(`Database update failed: ${error.message}`)
    },

    async markEventCancelled() {
      const { error } = await db.from('events').update({ status: 'cancelled' }).eq('id', eventId)
      if (error) throw new Error(`Database update failed: ${error.message}`)
    },
  }
}
