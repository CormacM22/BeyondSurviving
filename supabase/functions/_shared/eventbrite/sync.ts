// The step-by-step logic for sending an event to Eventbrite and publishing it.
//
// The one rule that matters most: never create a second Eventbrite event for
// the same event. So:
//  - the Eventbrite id is recorded the moment it exists, and every later save
//    updates that event;
//  - if creating the event fails in any way other than Eventbrite clearly
//    refusing, we can't know whether it exists, so the row stays locked and is
//    flagged until a person has checked Eventbrite.

import { descriptionHtml, eventPayload } from './payload.ts'
import { EventbriteError } from './types.ts'
import type { EventbriteApi, Meta, PublicationStore, Result } from './types.ts'

const BUSY = 'This event is already being sent to Eventbrite. Please wait a moment and refresh.'
const NEEDS_CHECK =
  'Eventbrite may have created this event, but the dashboard couldn’t confirm it. ' +
  'Please check Eventbrite for a duplicate draft before trying again.'
const GENERIC = 'Couldn’t finish sending to Eventbrite. Please try again.'

/** A message safe to show Ciara: Eventbrite's own reason, or a plain one. Details go to the log. */
function userMessage(e: unknown): string {
  if (e instanceof EventbriteError) return `Eventbrite said: ${e.message}`
  console.error(e)
  return GENERIC
}

/** Creates the Eventbrite draft on first save; updates it on every later save (draft or live). Never publishes. */
export async function syncToEventbrite(
  api: EventbriteApi,
  store: PublicationStore,
  opts: { listed: boolean },
): Promise<Result> {
  const claim = await store.claim()
  if (claim === 'busy') return { ok: false, message: BUSY }
  if (claim === 'needs_check') return { ok: false, message: NEEDS_CHECK }

  const meta: Meta = { ...claim.meta }
  let externalId = claim.externalId
  let url = claim.url

  const release = async (message: string): Promise<Result> => {
    await store.fail(message, { meta })
    return { ok: false, message }
  }
  const holdForCheck = async (): Promise<Result> => {
    await store.fail(NEEDS_CHECK, { needsCheck: true, meta })
    return { ok: false, message: NEEDS_CHECK }
  }

  // Set once Eventbrite may have created the event without us recording its id.
  // From then on the lock must never be released: if even flagging the row
  // fails, the error is left to escape and the stale lock becomes "needs check".
  let mayExistUnrecorded = false

  try {
    const ev = await store.loadEvent()
    if (ev.status === 'cancelled') return release('This event is cancelled, so changes aren’t sent to Eventbrite.')

    let venueId: string | null = null
    if (!ev.is_online && ev.public_area) {
      if (meta.venueId && meta.venueArea === ev.public_area) {
        venueId = meta.venueId
      } else {
        venueId = await api.createVenue(ev.public_area)
        meta.venueId = venueId
        meta.venueArea = ev.public_area
      }
    }

    const payload = eventPayload(ev, { venueId, listed: opts.listed })

    if (externalId === null) {
      let created: { id: string; url: string }
      try {
        created = await api.createEvent(payload)
      } catch (e) {
        if (e instanceof EventbriteError && e.definitelyRefused) return await release(userMessage(e))
        console.error(e)
        mayExistUnrecorded = true
        return await holdForCheck()
      }
      try {
        await store.recordCreated(created.id, created.url)
      } catch (e) {
        console.error(e)
        mayExistUnrecorded = true
        return await holdForCheck()
      }
      externalId = created.id
      url = created.url
    } else {
      await api.updateEvent(externalId, payload)
    }

    if (meta.ticketClassId) {
      await api.updateTicketQuantity(externalId, meta.ticketClassId, ev.capacity)
    } else {
      // An earlier save may have created the ticket without recording it: reuse it if so.
      const [existing] = await api.listTicketClassIds(externalId)
      if (existing) {
        await api.updateTicketQuantity(externalId, existing, ev.capacity)
        meta.ticketClassId = existing
      } else {
        meta.ticketClassId = await api.createFreeTicket(externalId, ev.capacity)
      }
      await store.saveMeta(meta)
    }

    await api.setDescription(externalId, descriptionHtml(ev.description))

    const coverPath = ev.cover_image_path ?? null
    if (coverPath !== (meta.coverPath ?? null)) {
      if (coverPath) {
        const logoId = await api.uploadLogo(await store.loadCover(coverPath))
        await api.updateEvent(externalId, { logo_id: logoId })
      } else {
        await api.updateEvent(externalId, { logo_id: null })
      }
      meta.coverPath = coverPath
    }

    // Take Eventbrite's word for whether the event is live, so the dashboard
    // repairs itself if an earlier publish finished without being recorded.
    let status = claim.status === 'not_started' ? 'draft' : claim.status
    if (claim.externalId !== null) {
      const remote = await api.getEventStatus(externalId)
      if (remote === 'live' || remote === 'started') status = 'live'
    }
    await store.succeed(status, meta)
    if (status === 'live') await store.markEventPublished()
    return { ok: true, url }
  } catch (e) {
    if (mayExistUnrecorded) throw e
    return await release(userMessage(e))
  }
}

/** Makes an Eventbrite draft live. Safe to repeat, and repairs the dashboard if a publish half-finished. */
export async function publishOnEventbrite(api: EventbriteApi, store: PublicationStore): Promise<Result> {
  const claim = await store.claim()
  if (claim === 'busy') return { ok: false, message: BUSY }
  if (claim === 'needs_check') return { ok: false, message: NEEDS_CHECK }

  const release = async (message: string): Promise<Result> => {
    await store.fail(message, {})
    return { ok: false, message }
  }
  const recordLive = async (): Promise<Result> => {
    try {
      await store.succeed('live', claim.meta)
      await store.markEventPublished()
      return { ok: true, url: claim.url }
    } catch (e) {
      console.error(e)
      return release(
        'The event is live on Eventbrite, but the dashboard couldn’t record it. ' +
          'Press “Try sending to Eventbrite again” to update the dashboard.',
      )
    }
  }

  try {
    const ev = await store.loadEvent()
    if (ev.status === 'cancelled') return release('This event is cancelled, so it can’t be published.')
    if (claim.status === 'live') return recordLive()
    if (claim.externalId === null || claim.status !== 'draft') {
      return release('Save the event to Eventbrite before publishing it.')
    }

    try {
      await api.publish(claim.externalId)
    } catch (e) {
      // The reply may have been lost after it went live, or an earlier publish may
      // already have done it. Ask Eventbrite before reporting a failure.
      const status = await api.getEventStatus(claim.externalId).catch(() => 'unknown')
      if (status !== 'live' && status !== 'started') return release(userMessage(e))
    }
    return recordLive()
  } catch (e) {
    return release(userMessage(e))
  }
}
