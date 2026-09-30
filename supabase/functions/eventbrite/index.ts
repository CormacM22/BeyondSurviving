// Server-side function the dashboard calls to send an event to Eventbrite.
//
//   POST { action: 'sync',        eventId }  create or update the Eventbrite copy
//   POST { action: 'publish',     eventId }  make the Eventbrite draft live
//   POST { action: 'cancel',      eventId }  cancel on Eventbrite and in the dashboard (can't be undone)
//   POST { action: 'clear_check', eventId }  after a person has checked Eventbrite
//                                            for a duplicate, allow saving again
//
// Secrets (never in the browser): EVENTBRITE_TOKEN, EVENTBRITE_ORG_ID.
// EVENTBRITE_LISTED must be exactly "true" for events to appear in Eventbrite
// search; anything else (including unset) keeps them unlisted, so the test
// project can never advertise test events.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { eventbriteApi } from '../_shared/eventbrite/api.ts'
import { publicationStore } from '../_shared/eventbrite/store.ts'
import { cancelOnEventbrite, publishOnEventbrite, syncToEventbrite } from '../_shared/eventbrite/sync.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

function env(name: string): string {
  const v = Deno.env.get(name)
  if (!v) throw new Error(`Missing secret ${name}`)
  return v
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return reply(405, { ok: false, message: 'Method not allowed' })

  try {
    // Who is asking, and are they allowed to manage events?
    const auth = req.headers.get('Authorization') ?? ''
    const asUser = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), {
      global: { headers: { Authorization: auth } },
    })
    const { data: allowed, error: permError } = await asUser.rpc('has_permission', { permission: 'events.manage' })
    if (permError || allowed !== true) return reply(403, { ok: false, message: 'You don’t have access to events.' })

    const { action, eventId } = await req.json().catch(() => ({}))
    if (typeof eventId !== 'string' || !['sync', 'publish', 'cancel', 'clear_check'].includes(action)) {
      return reply(400, { ok: false, message: 'Bad request' })
    }

    const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'))

    if (action === 'clear_check') {
      // Only a row actually flagged as needing a check can be released this way,
      // so this can never break the lock of a save that is still running.
      const { error } = await db
        .from('event_publications')
        .update({ needs_check: false, in_progress_since: null, last_error: null })
        .eq('event_id', eventId)
        .eq('target', 'eventbrite')
        .eq('needs_check', true)
      if (error) throw new Error(error.message)
      return reply(200, { ok: true, url: null })
    }

    const { count, error: countError } = await db.from('events').select('id', { count: 'exact', head: true }).eq('id', eventId)
    if (countError) throw new Error(countError.message)
    if (!count) return reply(404, { ok: false, message: 'Event not found.' })

    const api = eventbriteApi(env('EVENTBRITE_TOKEN'), env('EVENTBRITE_ORG_ID'))
    const store = publicationStore(db, eventId, 'eventbrite')
    const result = action === 'sync'
      ? await syncToEventbrite(api, store, { listed: Deno.env.get('EVENTBRITE_LISTED') === 'true' })
      : action === 'publish'
      ? await publishOnEventbrite(api, store)
      : await cancelOnEventbrite(api, store)

    return reply(result.ok ? 200 : 422, result)
  } catch (e) {
    console.error(e)
    return reply(500, { ok: false, message: 'Something went wrong on the server. Please try again.' })
  }
})
