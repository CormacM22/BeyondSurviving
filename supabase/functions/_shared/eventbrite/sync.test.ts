import { beforeEach, describe, expect, it } from 'vitest'
import { cancelOnEventbrite, publishOnEventbrite, syncToEventbrite } from './sync.ts'
import { EventbriteError } from './types.ts'
import type { EventbriteApi, EventRecord } from './types.ts'
import { inPersonEvent } from './fixtures.ts'
import { FakeStore } from './fake-store.ts'

// How a step can go wrong:
//  'refused'   Eventbrite clearly said no (400): it did nothing
//  'lost'      Eventbrite DID the thing, but the reply never arrived (network drop, timeout)
//  'unclear'   a 502 / network error before we know anything
type Failure = 'refused' | 'lost' | 'unclear' | 'has_registrations'

// A fake Eventbrite that keeps its own state, records calls, and can fail a step once.
class FakeEventbrite implements EventbriteApi {
  calls: string[] = []
  payloads: Record<string, unknown>[] = []
  failures = new Map<string, Failure>()
  events = new Map<string, { status: string; tickets: string[] }>()
  private n = 0

  // Runs a step, applying any failure set for it. `act` is what Eventbrite does.
  private async step<T>(name: string, act: () => T): Promise<T> {
    this.calls.push(name)
    const failure = this.failures.get(name)
    this.failures.delete(name)
    if (failure === 'refused') throw new EventbriteError(400, 'ARGUMENTS_ERROR')
    if (failure === 'unclear') throw new EventbriteError(502, 'Bad gateway')
    // What Eventbrite really replies when cancelling an event people have registered for.
    if (failure === 'has_registrations') throw new EventbriteError(400, 'This event cannot be canceled.', 'CANNOT_CANCEL')
    const result = act()
    if (failure === 'lost') throw new TypeError('network connection lost')
    return result
  }

  failNext(name: string, how: Failure) { this.failures.set(name, how) }

  createVenue(area: string) { return this.step(`createVenue:${area}`, () => `venue-${++this.n}`) }
  createEvent(p: Record<string, unknown>) {
    return this.step('createEvent', () => {
      this.payloads.push(p)
      const id = `eb-${++this.n}`
      this.events.set(id, { status: 'draft', tickets: [] })
      return { id, url: `https://eventbrite.test/e/${id}` }
    })
  }
  updateEvent(_id: string, p: Record<string, unknown>) { return this.step('updateEvent', () => { this.payloads.push(p) }) }
  listTicketClassIds(id: string) { return this.step('listTickets', () => [...(this.events.get(id)?.tickets ?? [])]) }
  createFreeTicket(id: string, qty: number) {
    return this.step(`createTicket:${qty}`, () => {
      const t = `ticket-${++this.n}`
      this.events.get(id)?.tickets.push(t)
      return t
    })
  }
  updateTicketQuantity(_id: string, _t: string, qty: number) { return this.step(`updateTicket:${qty}`, () => {}) }
  setDescription() { return this.step('setDescription', () => {}) }
  uploadLogo() { return this.step('uploadLogo', () => `logo-${++this.n}`) }
  publish(id: string) {
    return this.step('publish', () => {
      const ev = this.events.get(id)!
      if (ev.status === 'live') throw new EventbriteError(400, 'ALREADY_PUBLISHED')
      ev.status = 'live'
    })
  }
  cancel(id: string) { return this.step('cancel', () => { this.events.get(id)!.status = 'canceled' }) }
  getEventStatus(id: string) { return this.step('getStatus', () => this.events.get(id)?.status ?? 'unknown') }

  get eventCount() { return this.events.size }
  ticketsOf(id: string) { return this.events.get(id)?.tickets ?? [] }
}

let eb: FakeEventbrite
let store: FakeStore
const sync = (ev: EventRecord = inPersonEvent) => {
  store.event = ev
  return syncToEventbrite(eb, store, { listed: false })
}
const publish = () => publishOnEventbrite(eb, store)
const cancel = () => cancelOnEventbrite(eb, store)
// Simulates "some time later": a lock left behind by a crashed request has gone stale.
const later = () => { store.lockStale = true }

beforeEach(() => {
  eb = new FakeEventbrite()
  store = new FakeStore()
})

describe('syncToEventbrite: first save', () => {
  it('creates a venue, a draft event, a free ticket and the description', async () => {
    const result = await sync()
    expect(result.ok).toBe(true)
    expect(eb.calls).toEqual(['createVenue:Castlebar', 'createEvent', 'listTickets', 'createTicket:12', 'setDescription'])
    expect(store.pub.externalId).toBeTruthy()
    expect(store.pub.status).toBe('draft')
    expect(store.locked).toBe(false)
  })

  it('never publishes and sends the listed setting it was given', async () => {
    await sync()
    expect(eb.calls).not.toContain('publish')
    expect(eb.payloads[0].listed).toBe(false)
  })

  it('never sends the street address', async () => {
    await sync()
    expect(JSON.stringify(eb.payloads)).not.toContain('Main St')
  })

  it('an online event gets no venue', async () => {
    await sync({ ...inPersonEvent, is_online: true, public_area: null, venue_address: null })
    expect(eb.calls.some((c) => c.startsWith('createVenue'))).toBe(false)
    expect(eb.payloads[0].venue_id).toBeNull()
  })

  it('sends the event as it is in the database when the lock is taken', async () => {
    store.event = { ...inPersonEvent, title: 'Newest title' }
    await syncToEventbrite(eb, store, { listed: false })
    expect((eb.payloads[0].name as { html: string }).html).toBe('Newest title')
  })
})

describe('syncToEventbrite: saving again', () => {
  it('updates the same event instead of creating another', async () => {
    await sync()
    eb.calls = []
    await sync({ ...inPersonEvent, capacity: 15 })
    expect(eb.calls).toEqual(['getStatus', 'updateEvent', 'updateTicket:15', 'setDescription'])
    expect(eb.eventCount).toBe(1)
  })

  it('makes a new venue only when the area changes', async () => {
    await sync()
    eb.calls = []
    await sync({ ...inPersonEvent, public_area: 'Westport' })
    expect(eb.calls.slice(0, 2)).toEqual(['getStatus', 'createVenue:Westport'])
  })

  it('keeps the status of a live event when it is edited', async () => {
    await sync()
    store.pub.status = 'live'
    await sync({ ...inPersonEvent, title: 'New title' })
    expect(store.pub.status).toBe('live')
  })

  it('clearing the summary clears it on Eventbrite', async () => {
    await sync()
    await sync({ ...inPersonEvent, summary: null })
    expect(eb.payloads.at(-1)!.summary).toBe('')
  })
})

describe('syncToEventbrite: never a duplicate event', () => {
  it('if Eventbrite clearly refuses to create it, a retry creates it (still only one)', async () => {
    eb.failNext('createEvent', 'refused')
    expect((await sync()).ok).toBe(false)
    expect(store.locked).toBe(false)
    expect(store.needsCheck).toBe(false)

    expect((await sync()).ok).toBe(true)
    expect(eb.eventCount).toBe(1)
  })

  it('if Eventbrite created it but the reply was lost, it asks for a check instead of retrying', async () => {
    eb.failNext('createEvent', 'lost')
    const result = await sync()
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.message).toMatch(/check Eventbrite/i)
    expect(store.needsCheck).toBe(true)
    expect(store.locked).toBe(true)

    later()
    expect((await sync()).ok).toBe(false)
    expect(eb.eventCount).toBe(1)
  })

  it('an unclear error (502) while creating is treated the same way', async () => {
    eb.failNext('createEvent', 'unclear')
    await sync()
    expect(store.needsCheck).toBe(true)
    later()
    await sync()
    expect(eb.calls.filter((c) => c === 'createEvent')).toHaveLength(1)
  })

  it('if Eventbrite created it but we could not record the id, it asks for a check', async () => {
    store.failNextWrite = true
    const result = await sync()
    expect(result.ok).toBe(false)
    expect(store.needsCheck).toBe(true)
    later()
    await sync()
    expect(eb.eventCount).toBe(1)
  })

  it('if a later step fails, retrying updates the event already created', async () => {
    eb.failNext('setDescription', 'unclear')
    expect((await sync()).ok).toBe(false)
    expect(store.locked).toBe(false)
    expect(store.needsCheck).toBe(false)
    expect((await sync()).ok).toBe(true)
    expect(eb.eventCount).toBe(1)
  })

  it('if even recording "needs a check" fails, the lock is still never released', async () => {
    eb.failNext('createEvent', 'lost')
    store.failNextFail = true
    await sync().catch(() => {})
    expect(store.locked).toBe(true)
    later()
    await sync().catch(() => {})
    expect(eb.eventCount).toBe(1)
  })

  it('does nothing while another save is in progress', async () => {
    store.locked = true
    const result = await sync()
    expect(result.ok).toBe(false)
    expect(eb.calls).toEqual([])
  })

  it('a cancelled event is never sent', async () => {
    const result = await sync({ ...inPersonEvent, status: 'cancelled' })
    expect(result.ok).toBe(false)
    expect(eb.calls).toEqual([])
    expect(store.locked).toBe(false)
  })
})

describe('syncToEventbrite: keeps the dashboard in step with Eventbrite', () => {
  it('if an event went live without the dashboard knowing, saving records it as live', async () => {
    await sync()
    eb.events.get(store.pub.externalId!)!.status = 'live'
    expect((await sync()).ok).toBe(true)
    expect(store.pub.status).toBe('live')
    expect(store.eventPublished).toBe(true)
  })

  it('a live event whose dashboard status never got updated is repaired by saving', async () => {
    await sync()
    await publish()
    store.eventPublished = false
    await sync()
    expect(store.eventPublished).toBe(true)
  })

  it('a draft stays a draft', async () => {
    await sync()
    await sync()
    expect(store.pub.status).toBe('draft')
    expect(store.eventPublished).toBe(false)
  })
})

describe('syncToEventbrite: never a duplicate ticket', () => {
  it('a ticket created but not recorded is found and reused', async () => {
    eb.failNext('createTicket:12', 'lost')
    await sync()
    await sync()
    const id = store.pub.externalId!
    expect(eb.ticketsOf(id)).toHaveLength(1)
    expect(store.pub.meta.ticketClassId).toBe(eb.ticketsOf(id)[0])
  })

  it('a recorded ticket is updated, not looked up or created again', async () => {
    await sync()
    eb.calls = []
    await sync()
    expect(eb.calls).not.toContain('listTickets')
    expect(eb.calls.some((c) => c.startsWith('createTicket'))).toBe(false)
  })
})

describe('syncToEventbrite: cover image', () => {
  const withCover = { ...inPersonEvent, cover_image_path: 'ev-1/cover-1.jpg' }

  it('uploads the cover once and does not re-upload an unchanged one', async () => {
    await sync(withCover)
    expect(eb.calls).toContain('uploadLogo')
    eb.calls = []
    await sync(withCover)
    expect(eb.calls).not.toContain('uploadLogo')
  })

  it('uploads again when the cover changes, and clears it when removed', async () => {
    await sync(withCover)
    eb.calls = []
    await sync({ ...withCover, cover_image_path: 'ev-1/cover-2.png' })
    expect(eb.calls).toContain('uploadLogo')
    eb.payloads = []
    await sync({ ...withCover, cover_image_path: null })
    expect(eb.payloads.some((p) => 'logo_id' in p && p.logo_id === null)).toBe(true)
  })
})

describe('error messages', () => {
  it('database details are not shown to the user', async () => {
    await sync()
    store.failNextWrite = true
    const result = await sync()
    expect(result.ok === false && result.message).not.toMatch(/database unavailable/)
  })

  it('Eventbrite’s own reason is passed on', async () => {
    eb.failNext('createEvent', 'refused')
    const result = await sync()
    expect(result.ok === false && result.message).toMatch(/ARGUMENTS_ERROR/)
  })
})

describe('publishOnEventbrite', () => {
  it('publishes a draft once and marks the event published', async () => {
    await sync()
    eb.calls = []
    const result = await publish()
    expect(result.ok).toBe(true)
    expect(eb.calls).toEqual(['getStatus', 'publish', 'getStatus'])
    expect(store.pub.status).toBe('live')
    expect(store.eventPublished).toBe(true)
  })

  it('publishing an already-live event does not call Eventbrite again', async () => {
    await sync()
    await publish()
    eb.calls = []
    expect((await publish()).ok).toBe(true)
    expect(eb.calls).toEqual([])
  })

  it('refuses if the event has not been sent to Eventbrite yet', async () => {
    const result = await publish()
    expect(result.ok).toBe(false)
    expect(eb.calls).toEqual([])
    expect(store.locked).toBe(false)
  })

  it('refuses a cancelled event', async () => {
    await sync()
    store.event = { ...inPersonEvent, status: 'cancelled' }
    eb.calls = []
    expect((await publish()).ok).toBe(false)
    expect(eb.calls).toEqual([])
  })

  it('if Eventbrite refuses, the event stays a draft and the reason is kept', async () => {
    await sync()
    eb.failNext('publish', 'refused')
    const result = await publish()
    expect(result.ok).toBe(false)
    expect(store.pub.status).toBe('draft')
    expect(store.eventPublished).toBe(false)
    expect(store.lastError).toBeTruthy()
    expect(store.locked).toBe(false)
  })

  it('if the publish reply was lost, it checks Eventbrite and records it as live', async () => {
    await sync()
    eb.failNext('publish', 'lost')
    const result = await publish()
    expect(result.ok).toBe(true)
    expect(store.pub.status).toBe('live')
    expect(store.eventPublished).toBe(true)
  })

  it('if it went live but the dashboard could not record it, publishing again repairs it', async () => {
    await sync()
    store.failNextWrite = true
    expect((await publish()).ok).toBe(false)
    expect(store.locked).toBe(false)

    const retry = await publish()
    expect(retry.ok).toBe(true)
    expect(store.pub.status).toBe('live')
    expect(store.eventPublished).toBe(true)
  })

  it('a live Eventbrite event whose dashboard status never got updated is repaired', async () => {
    await sync()
    await publish()
    store.eventPublished = false
    expect((await publish()).ok).toBe(true)
    expect(store.eventPublished).toBe(true)
  })
})

describe('syncToEventbrite: an event cancelled on Eventbrite is never edited', () => {
  it('if Eventbrite says it is cancelled, nothing is sent and the dashboard records it', async () => {
    await sync()
    eb.events.get(store.pub.externalId!)!.status = 'canceled'
    eb.calls = []
    const result = await sync({ ...inPersonEvent, title: 'Edited after cancel' })
    expect(result.ok).toBe(false)
    expect(eb.calls).toEqual(['getStatus'])
    expect(store.pub.status).toBe('cancelled')
    expect(store.eventCancelled).toBe(true)
    expect(store.locked).toBe(false)
  })
})

describe('cancelOnEventbrite', () => {
  it('an event never sent to Eventbrite is just marked cancelled', async () => {
    const result = await cancel()
    expect(result.ok).toBe(true)
    expect(eb.calls).toEqual([])
    expect(store.pub.status).toBe('cancelled')
    expect(store.eventCancelled).toBe(true)
  })

  it('cancels a draft on Eventbrite', async () => {
    await sync()
    eb.calls = []
    expect((await cancel()).ok).toBe(true)
    expect(eb.calls).toEqual(['cancel'])
    expect(eb.events.get(store.pub.externalId!)!.status).toBe('canceled')
    expect(store.pub.status).toBe('cancelled')
    expect(store.eventCancelled).toBe(true)
  })

  it('cancels a live event on Eventbrite', async () => {
    await sync()
    await publish()
    eb.calls = []
    expect((await cancel()).ok).toBe(true)
    expect(eb.calls).toEqual(['cancel'])
    expect(store.pub.status).toBe('cancelled')
  })

  it('cancelling again does not call Eventbrite', async () => {
    await sync()
    await cancel()
    eb.calls = []
    expect((await cancel()).ok).toBe(true)
    expect(eb.calls).toEqual([])
  })

  it('if the cancel reply was lost, it checks Eventbrite and records the cancel', async () => {
    await sync()
    eb.failNext('cancel', 'lost')
    expect((await cancel()).ok).toBe(true)
    expect(store.pub.status).toBe('cancelled')
    expect(store.eventCancelled).toBe(true)
  })

  it('if Eventbrite refuses, nothing changes and the reason is shown', async () => {
    await sync()
    await publish()
    eb.failNext('cancel', 'refused')
    const result = await cancel()
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.message).toMatch(/ARGUMENTS_ERROR/)
    expect(store.pub.status).toBe('live')
    expect(store.eventCancelled).toBe(false)
    expect(store.locked).toBe(false)
  })

  it('if it was cancelled on Eventbrite but the dashboard could not record it, cancelling again repairs it', async () => {
    await sync()
    store.failNextWrite = true
    expect((await cancel()).ok).toBe(false)
    expect(store.locked).toBe(false)
    expect((await cancel()).ok).toBe(true)
    expect(store.pub.status).toBe('cancelled')
    expect(store.eventCancelled).toBe(true)
  })

  it('does nothing while a save is in progress', async () => {
    await sync()
    store.locked = true
    eb.calls = []
    expect((await cancel()).ok).toBe(false)
    expect(eb.calls).toEqual([])
  })

  it('does nothing while an earlier save needs checking', async () => {
    store.locked = true
    store.lockStale = true
    const result = await cancel()
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.message).toMatch(/check Eventbrite/i)
    expect(eb.calls).toEqual([])
    expect(store.eventCancelled).toBe(false)
  })

  it('after cancelling, saving and publishing are refused without contacting Eventbrite', async () => {
    await sync()
    await cancel()
    eb.calls = []
    expect((await syncToEventbrite(eb, store, { listed: false })).ok).toBe(false)
    expect((await publish()).ok).toBe(false)
    expect(eb.calls).toEqual([])
  })
})

describe('cancelled events stay cancelled everywhere', () => {
  it('Publish on an event cancelled directly on Eventbrite records the cancel, never "live"', async () => {
    await sync()
    eb.events.get(store.pub.externalId!)!.status = 'canceled'
    eb.calls = []
    const result = await publish()
    expect(result.ok).toBe(false)
    expect(eb.calls).not.toContain('publish')
    expect(store.pub.status).toBe('cancelled')
    expect(store.eventCancelled).toBe(true)
    expect(store.eventPublished).toBe(false)
  })

  it('a publish Eventbrite claims worked but did not is not recorded as live', async () => {
    await sync()
    const orig = eb.publish.bind(eb)
    eb.publish = async (id: string) => { eb.calls.push('publish') } // says yes, does nothing
    const result = await publish()
    eb.publish = orig
    expect(result.ok).toBe(false)
    expect(store.pub.status).toBe('draft')
    expect(store.eventPublished).toBe(false)
  })

  it('if only the publication was recorded as cancelled, a save never creates an Eventbrite draft', async () => {
    await cancel()                        // never sent: cancelled in the dashboard only
    store.event = { ...inPersonEvent }    // simulate the event row not saying cancelled
    store.eventCancelled = false
    eb.calls = []
    const result = await syncToEventbrite(eb, store, { listed: false })
    expect(result.ok).toBe(false)
    expect(eb.calls).toEqual([])
    expect(store.eventCancelled).toBe(true) // repaired
  })

  it('the event is marked cancelled first, so a failure part-way leaves saving blocked', async () => {
    await sync()
    store.failNextWrite = false
    // Eventbrite cancel works, the event row is written, then the publication write fails.
    const origSucceed = store.succeed.bind(store)
    store.succeed = async () => { throw new Error('database unavailable') }
    expect((await cancel()).ok).toBe(false)
    store.succeed = origSucceed
    expect(store.eventCancelled).toBe(true)
    eb.calls = []
    expect((await syncToEventbrite(eb, store, { listed: false })).ok).toBe(false)
    expect(eb.calls).toEqual([])
  })

  it('if the cancel could not be recorded at all, the message asks to press Cancel again', async () => {
    await sync()
    store.failMarkCancelled = true
    const result = await cancel()
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.message).toMatch(/Cancel event/)
    expect((await cancel()).ok).toBe(true)
    expect(store.eventCancelled).toBe(true)
  })

  it('refusing to touch a cancelled event leaves no error behind', async () => {
    await sync()
    await cancel()
    await syncToEventbrite(eb, store, { listed: false })
    await publish()
    expect(store.lastError).toBeNull()
    expect(store.locked).toBe(false)
  })
})

describe('cancelling an event people have registered for', () => {
  it('explains how to cancel it on Eventbrite, and changes nothing', async () => {
    await sync()
    await publish()
    eb.failNext('cancel', 'has_registrations')
    const result = await cancel()
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.message).toMatch(/registered/)
    expect(result.ok === false && result.message).toMatch(/on Eventbrite/)
    expect(store.pub.status).toBe('live')
    expect(store.eventCancelled).toBe(false)
    expect(store.locked).toBe(false)
  })

  it('once cancelled on Eventbrite, pressing Cancel here records it', async () => {
    await sync()
    await publish()
    eb.failNext('cancel', 'has_registrations')
    await cancel()
    eb.events.get(store.pub.externalId!)!.status = 'canceled' // Ciara cancels it on Eventbrite
    eb.failNext('cancel', 'has_registrations')                // and the API still says no
    expect((await cancel()).ok).toBe(true)
    expect(store.pub.status).toBe('cancelled')
    expect(store.eventCancelled).toBe(true)
  })
})

describe('an event deleted on Eventbrite (how Ciara cancels one with registrations)', () => {
  // In the Eventbrite website: refund everyone, then "…" → Delete event.
  const deleteOnEventbrite = () => { eb.events.get(store.pub.externalId!)!.status = 'deleted' }

  it('pressing Cancel here records it as cancelled', async () => {
    await sync()
    await publish()
    deleteOnEventbrite()
    eb.failNext('cancel', 'refused') // Eventbrite: "already canceled or deleted"
    expect((await cancel()).ok).toBe(true)
    expect(store.pub.status).toBe('cancelled')
    expect(store.eventCancelled).toBe(true)
  })

  it('saving never sends edits to it, and records the cancel', async () => {
    await sync()
    deleteOnEventbrite()
    eb.calls = []
    expect((await sync()).ok).toBe(false)
    expect(eb.calls).toEqual(['getStatus'])
    expect(store.eventCancelled).toBe(true)
  })

  it('publishing never touches it, and records the cancel', async () => {
    await sync()
    deleteOnEventbrite()
    eb.calls = []
    expect((await publish()).ok).toBe(false)
    expect(eb.calls).not.toContain('publish')
    expect(store.eventCancelled).toBe(true)
  })
})

