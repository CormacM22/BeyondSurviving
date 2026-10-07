// Shapes for publishing an event to the Events section of the WordPress site.
// Plain TypeScript, so it runs in the Edge Function and in the unit tests.

/** An error response from WordPress, with its HTTP status and code. */
export class WordPressError extends Error {
  constructor(readonly status: number, message: string, readonly code?: string) {
    super(message)
  }

  /** True only when WordPress clearly refused (a 4xx other than timeout / rate-limit), so it did nothing. */
  get definitelyRefused(): boolean {
    return this.status >= 400 && this.status < 500 && this.status !== 408 && this.status !== 429
  }
}

export type PostStatus = 'draft' | 'publish'

/** The website's "Event Details" fields (ACF), as the event cards show them. Never `Text`. */
export type EventDetails = {
  event_date: string
  event_start_time: string
  event_end_time: string
  event_location: string
}

/** One of the website's Events posts, as offered for reuse. */
export type PostSummary = {
  id: string
  title: string
  status: string
  /** The session it currently shows (Ymd), if any. */
  eventDate: string | null
  location: string
  /** Whether the dashboard may edit it (its Author is Events Dashboard). */
  editable: boolean
}

export interface WordPressApi {
  createPost(post: { title: string; content: string; status: PostStatus; acf: EventDetails }): Promise<{ id: string; link: string }>
  updatePost(id: string, fields: { title?: string; content?: string; status?: PostStatus; acf?: EventDetails }): Promise<void>
  /** An existing post's status and address, or null if it no longer exists. */
  getPost(id: string): Promise<{ status: string; link: string } | null>
  /** WordPress's status for the post: 'draft', 'publish', 'pending', 'trash'… or 'gone' if it no longer exists. */
  getPostStatus(id: string): Promise<string>
  /** Published Events posts, plus the dashboard's own hidden ones (e.g. taken down after a cancellation). */
  listEventPosts(): Promise<PostSummary[]>
}
