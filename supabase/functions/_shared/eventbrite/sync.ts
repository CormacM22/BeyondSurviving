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
import type { EventbriteApi, Meta, PublicationStatus, PublicationStore, Result } from './types.ts'

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

const CANCELLED = 'This event is cancelled, so it can’t be changed or published.'

/**
 * Eventbrite statuses that mean the event is over for good: cancelled via the
 * API, or deleted in the Eventbrite website (how an event with registrations is
 * cancelled). Eventbrite still accepts edits to both, so we must never send any.
 */
const isGone = (status: string) => status === 'canceled' || status === 'deleted'
// Eventbrite refuses to cancel through the API once anyone has registered
// (confirmed on the test account 2026-09-30); it has to be done on Eventbrite.
// In the Eventbrite website: refund every registration (even for free events), then
// "…" beside the event → Delete event (found by Cormac 2026-09-30).
const HAS_REGISTRATIONS =
  'Eventbrite won’t let the dashboard cancel an event that people have registered for. ' +
  'Please do it on Eventbrite: first refund every registration (even though the event is free), ' +
  'then in your events list click the “…” beside this event and choose Delete event. ' +
  'Then press “Cancel event…” here again to record it.'

/**
 * Records a cancellation in the dashboard and releases the lock, leaving no error
 * behind. The event row goes first: it's what blocks saving and publishing, so
 * if the second write fails, nothing can be sent in the meantime.
 */
async function settleCancelled(store: PublicationStore, meta: Meta): Promise<Result> {
  await store.markEventCancelled()
  await store.succeed('cancelled', meta)
  return { ok: false, message: CANCELLED }
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
    if (ev.status === 'cancelled' || claim.status === 'cancelled') return await settleCancelled(store, meta)

    let status: PublicationStatus = claim.status === 'not_started' ? 'draft' : claim.status
    if (externalId !== null) {
      // Ask Eventbrite first. It accepts edits even to a cancelled event, so this
      // is what stops us changing one; it also repairs a publish or cancel that
      // finished on Eventbrite without being recorded here.
      const remote = await api.getEventStatus(externalId)
      if (isGone(remote)) return await settleCancelled(store, meta)
      if (remote === 'live' || remote === 'started') status = 'live'
    }

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
    if (ev.status === 'cancelled' || claim.status === 'cancelled') return await settleCancelled(store, claim.meta)
    if (claim.status === 'live') return recordLive()
    if (claim.externalId === null || claim.status !== 'draft') {
      return release('Save the event to Eventbrite before publishing it.')
    }

    // Ask Eventbrite first: it may have been cancelled or published there directly.
    const isLive = (s: string) => s === 'live' || s === 'started'
    const before = await api.getEventStatus(claim.externalId)
    if (isGone(before)) return await settleCancelled(store, claim.meta)

    if (!isLive(before)) {
      let publishError: unknown = null
      try {
        await api.publish(claim.externalId)
      } catch (e) {
        publishError = e // the reply may have been lost after it went live: check below
      }
      // Only Eventbrite's own status counts: it says "published" even when it isn't.
      const after = await api.getEventStatus(claim.externalId).catch(() => 'unknown')
      if (isGone(after)) return await settleCancelled(store, claim.meta)
      if (!isLive(after)) {
        return release(publishError ? userMessage(publishError) : 'Eventbrite didn’t make the event live. Please try again.')
      }
    }
    return recordLive()
  } catch (e) {
    return release(userMessage(e))
  }
}

/**
 * Cancels the event on Eventbrite (draft or live), then in the dashboard.
 * Can't be undone. Safe to repeat, and repairs the dashboard if a cancel half-finished.
 */
export async function cancelOnEventbrite(api: EventbriteApi, store: PublicationStore): Promise<Result> {
  const claim = await store.claim()
  if (claim === 'busy') return { ok: false, message: BUSY }
  if (claim === 'needs_check') return { ok: false, message: NEEDS_CHECK }

  const release = async (message: string): Promise<Result> => {
    await store.fail(message, {})
    return { ok: false, message }
  }
  const recordCancelled = async (): Promise<Result> => {
    try {
      // Event row first: it's what blocks saving and publishing.
      await store.markEventCancelled()
      await store.succeed('cancelled', claim.meta)
      return { ok: true, url: claim.url }
    } catch (e) {
      console.error(e)
      return release(
        'The event may be cancelled on Eventbrite, but the dashboard couldn’t record it. ' +
          'Press “Cancel event…” again to finish.',
      )
    }
  }

  try {
    // Never sent to Eventbrite, or already cancelled there: only the dashboard needs updating.
    if (claim.externalId === null || claim.status === 'cancelled') return recordCancelled()

    try {
      await api.cancel(claim.externalId)
    } catch (e) {
      // The reply may have been lost after it was cancelled: ask before reporting a failure.
      const status = await api.getEventStatus(claim.externalId).catch(() => 'unknown')
      if (!isGone(status)) {
        const hasRegistrations = e instanceof EventbriteError && e.code === 'CANNOT_CANCEL'
        return release(hasRegistrations ? HAS_REGISTRATIONS : userMessage(e))
      }
    }
    return recordCancelled()
  } catch (e) {
    return release(userMessage(e))
  }
}
