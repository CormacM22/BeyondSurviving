// Shapes shared by the Eventbrite publishing logic. Plain TypeScript with no
// Deno- or Node-specific imports, so the same files run in the Supabase Edge
// Function and in the unit tests.

export type Category = 'support_group' | 'community_event' | 'fundraiser'

/** A row of public.events, as the function reads it. */
export type EventRecord = {
  id: string
  title: string
  summary: string | null
  description: string
  starts_at: string
  ends_at: string
  timezone: string
  is_online: boolean
  public_area: string | null
  venue_name: string | null
  venue_address: string | null
  capacity: number
  category: Category
  cover_image_path: string | null
  status: 'draft' | 'published' | 'cancelled'
}

/** Eventbrite-side ids we need to remember between saves. */
export type Meta = {
  venueId?: string
  venueArea?: string
  ticketClassId?: string
  coverPath?: string | null
}

export type PublicationStatus = 'not_started' | 'draft' | 'live' | 'cancelled'

/** The event's row in public.event_publications for target 'eventbrite'. */
export type Publication = {
  externalId: string | null
  url: string | null
  status: PublicationStatus
  meta: Meta
}

/**
 * Result of trying to lock the publication row for a save:
 * - the row, if we got the lock
 * - 'busy' if another save is in progress
 * - 'needs_check' if an earlier save may have created the event on Eventbrite
 *   without recording it: a person must check Eventbrite before trying again
 */
export type Claim = Publication | 'busy' | 'needs_check'

export type Result = { ok: true; url: string | null } | { ok: false; message: string }

/** An error response from Eventbrite, with its HTTP status. */
export class EventbriteError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }

  /**
   * True only when Eventbrite clearly refused the request (a 4xx other than
   * timeout / rate-limit), so we know it did NOT act on it. Anything else
   * (network failure, timeout, 5xx, garbled reply) means it might have.
   */
  get definitelyRefused(): boolean {
    return this.status >= 400 && this.status < 500 && this.status !== 408 && this.status !== 429
  }
}

export interface EventbriteApi {
  createVenue(area: string): Promise<string>
  createEvent(payload: Record<string, unknown>): Promise<{ id: string; url: string }>
  updateEvent(eventId: string, payload: Record<string, unknown>): Promise<void>
  listTicketClassIds(eventId: string): Promise<string[]>
  createFreeTicket(eventId: string, quantity: number): Promise<string>
  updateTicketQuantity(eventId: string, ticketClassId: string, quantity: number): Promise<void>
  setDescription(eventId: string, html: string): Promise<void>
  uploadLogo(file: { bytes: Uint8Array; contentType: string }): Promise<string>
  publish(eventId: string): Promise<void>
  /** Eventbrite's own status for the event, e.g. 'draft' or 'live'. */
  getEventStatus(eventId: string): Promise<string>
}

/** Database access for one event's Eventbrite publication. */
export interface PublicationStore {
  claim(): Promise<Claim>
  /** Reads the event fresh, after the lock is taken, so a slow request can't send stale details. */
  loadEvent(): Promise<EventRecord>
  /** Must be called straight after Eventbrite creates the event. */
  recordCreated(externalId: string, url: string): Promise<void>
  saveMeta(meta: Meta): Promise<void>
  /** Releases the lock and clears any earlier error. */
  succeed(status: PublicationStatus, meta: Meta): Promise<void>
  /**
   * Records the error and releases the lock, unless needsCheck: then the lock is
   * kept and the row is flagged until a person confirms they've checked Eventbrite.
   */
  fail(message: string, opts: { needsCheck?: boolean; meta?: Meta }): Promise<void>
  loadCover(path: string): Promise<{ bytes: Uint8Array; contentType: string }>
  markEventPublished(): Promise<void>
}
