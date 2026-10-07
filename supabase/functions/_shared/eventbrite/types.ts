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
  /** The website post's own title and short text (the description is Eventbrite's). */
  website_title: string | null
  website_text: string | null
  /** The location line on the website's event card, e.g. "Online (Weekly)". */
  website_location: string | null
  /** An existing website post to reuse for this event, instead of creating a new one. */
  website_post_id: string | null
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
  /** WordPress: the status the dashboard last gave the post, to tell when Ciara has changed it. */
  lastSetStatus?: string
  /** WordPress: Ciara has changed the post's status herself, so the dashboard never sets it again. */
  statusOwnedByCiara?: boolean
  /** WordPress: this event's post was reused by a later event; this event never touches it again. */
  handedOver?: boolean
  /**
   * WordPress: this event's post choice when it handed its post over ('' = "create a new
   * post"). Changing the choice afterwards starts afresh; leaving it does nothing.
   */
  handedOverChoice?: string
  /** WordPress: the post is one of Ciara's existing posts, reused for this event. */
  reused?: boolean
  /** WordPress: an informational note for the panel (not an error), e.g. "removed in WordPress". */
  note?: string | null
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
  /** `message` is Eventbrite's description; `code` its error code, e.g. 'CANNOT_CANCEL'. */
  constructor(readonly status: number, message: string, readonly code?: string) {
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
  /** Cancels a draft or live event. Can't be undone; safe to repeat. */
  cancel(eventId: string): Promise<void>
  /** Eventbrite's own status for the event, e.g. 'draft' or 'live'. */
  getEventStatus(eventId: string): Promise<string>
}

/** Database access for one event's Eventbrite publication. */
export interface PublicationStore {
  claim(): Promise<Claim>
  /** Reads the event fresh, after the lock is taken, so a slow request can't send stale details. */
  loadEvent(): Promise<EventRecord>
  /** The event's Eventbrite publication (status and link), for the website post. */
  loadEventbriteLink(): Promise<{ status: PublicationStatus; url: string | null } | null>
  /**
   * Makes this event the one holding an existing website post, handing it over from
   * any earlier event (which then never touches it again). 'busy' if another event
   * is updating that post right now.
   */
  takeOverPost(postId: string, url: string): Promise<'ok' | 'busy' | 'upcoming'>
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
  markEventCancelled(): Promise<void>
}
