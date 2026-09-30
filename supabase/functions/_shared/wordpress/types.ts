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

export interface WordPressApi {
  createPost(post: { title: string; content: string; status: PostStatus }): Promise<{ id: string; link: string }>
  updatePost(id: string, fields: { title?: string; content?: string; status?: PostStatus }): Promise<void>
  /** WordPress's status for the post: 'draft', 'publish', 'pending', 'trash'… or 'gone' if it no longer exists. */
  getPostStatus(id: string): Promise<string>
}
