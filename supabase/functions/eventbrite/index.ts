// Server-side function the dashboard calls to publish an event to Eventbrite
// and to the Events section of the WordPress site.
//
//   POST { action: 'sync',        eventId }  create or update the Eventbrite copy
//                                            (and the website post, if the event is live)
//   POST { action: 'publish',     eventId }  make the Eventbrite draft live, then post it on the website
//   POST { action: 'cancel',      eventId }  cancel on Eventbrite, then take the website post down
//                                            (can't be undone)
//   POST { action: 'website',     eventId }  retry just the website step
//   POST { action: 'clear_check', eventId, target? }  after a person has checked Eventbrite
//                                            (or WordPress) for a duplicate, allow saving again
//
// Secrets (never in the browser): EVENTBRITE_TOKEN, EVENTBRITE_ORG_ID, WORDPRESS_URL,
// WORDPRESS_USER, WORDPRESS_APP_PASSWORD.
// EVENTBRITE_LISTED must be exactly "true" for events to appear in Eventbrite
// search, and WORDPRESS_POST_STATUS exactly "publish" for website posts to go
// public. Anything else (including unset) keeps them unlisted / as hidden
// drafts, so testing can never advertise test events.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { eventbriteApi } from '../_shared/eventbrite/api.ts'
import { publicationStore } from '../_shared/eventbrite/store.ts'
import { cancelOnEventbrite, publishOnEventbrite, syncToEventbrite } from '../_shared/eventbrite/sync.ts'
import type { Result } from '../_shared/eventbrite/types.ts'
import { wordpressApi } from '../_shared/wordpress/api.ts'
import { syncToWordPress, takeDownFromWordPress } from '../_shared/wordpress/sync.ts'

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

    const { action, eventId, target = 'eventbrite' } = await req.json().catch(() => ({}))
    if (typeof eventId !== 'string' || !['sync', 'publish', 'cancel', 'website', 'clear_check'].includes(action)) {
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
        .eq('target', target === 'wordpress' ? 'wordpress' : 'eventbrite')
        .eq('needs_check', true)
      if (error) throw new Error(error.message)
      return reply(200, { ok: true, url: null })
    }

    const { count, error: countError } = await db.from('events').select('id', { count: 'exact', head: true }).eq('id', eventId)
    if (countError) throw new Error(countError.message)
    if (!count) return reply(404, { ok: false, message: 'Event not found.' })

    const api = eventbriteApi(env('EVENTBRITE_TOKEN'), env('EVENTBRITE_ORG_ID'))
    const store = publicationStore(db, eventId, 'eventbrite')

    const wpStore = publicationStore(db, eventId, 'wordpress')
    const wp = () => wordpressApi(env('WORDPRESS_URL'), env('WORDPRESS_USER'), env('WORDPRESS_APP_PASSWORD'))
    const postStatus = Deno.env.get('WORDPRESS_POST_STATUS') === 'publish' ? 'publish' : 'draft'
    // The website step follows the event: posted while it's live on Eventbrite,
    // taken down once it's cancelled, and left alone otherwise.
    const websiteStep = async (): Promise<Result | null> => {
      const ev = await wpStore.loadEvent()
      if (ev.status === 'cancelled') return takeDownFromWordPress(wp(), wpStore)
      const link = await wpStore.loadEventbriteLink()
      if (link?.status === 'live') return syncToWordPress(wp(), wpStore, { postStatus })
      return null
    }
    // A website problem must never turn a finished Eventbrite step into an error.
    const WEBSITE_FAILED = 'The website couldn’t be updated. Press “Update the website” to try again.'
    const safely = async (step: () => Promise<Result | null>): Promise<Result | null> => {
      try {
        return await step()
      } catch (e) {
        console.error(e)
        return { ok: false, message: WEBSITE_FAILED }
      }
    }

    if (action === 'website') {
      const website = await safely(websiteStep)
      const result = website ?? { ok: false, message: 'The website post is created once the event is live on Eventbrite.' }
      return reply(result.ok ? 200 : 422, { ...result, website })
    }

    const result = action === 'sync'
      ? await syncToEventbrite(api, store, { listed: Deno.env.get('EVENTBRITE_LISTED') === 'true' })
      : action === 'publish'
      ? await publishOnEventbrite(api, store)
      : await cancelOnEventbrite(api, store)

    // After Eventbrite succeeded, or whenever the event has ended up cancelled
    // (e.g. it was cancelled directly on Eventbrite), so the post comes down too.
    // A website failure is reported separately, with its own retry, and doesn't
    // undo the Eventbrite step.
    const website = await safely(async () => {
      const cancelledNow = (await wpStore.loadEvent()).status === 'cancelled'
      return result.ok || cancelledNow ? websiteStep() : null
    })
    return reply(result.ok ? 200 : 422, { ...result, website })
  } catch (e) {
    console.error(e)
    return reply(500, { ok: false, message: 'Something went wrong on the server. Please try again.' })
  }
})
