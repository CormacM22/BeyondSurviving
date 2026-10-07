// Test double for the database side of publishing: one publication row, with the
// same lock rules as the real claim_publication().
import type { Claim, EventRecord, Meta, Publication, PublicationStore } from './types.ts'
import { inPersonEvent } from './fixtures.ts'

// A fake store holding one publication row, with the same lock rules as the real one.
export class FakeStore implements PublicationStore {
  event: EventRecord = inPersonEvent
  pub: Publication = { externalId: null, url: null, status: 'not_started', meta: {} }
  locked = false
  lockStale = false
  needsCheck = false
  lastError: string | null = null
  eventPublished = false
  /** The event's Eventbrite publication, as the WordPress step sees it. */
  eventbriteLink: { status: Publication['status']; url: string | null } | null = null
  failNextWrite = false
  failNextFail = false
  failMarkCancelled = false

  private write() {
    if (this.failNextWrite) { this.failNextWrite = false; throw new Error('database unavailable') }
  }

  async claim(): Promise<Claim> {
    if (this.locked && !this.lockStale) return 'busy'
    if (this.locked && this.pub.externalId === null) { this.needsCheck = true; return 'needs_check' }
    this.locked = true
    this.lockStale = false
    return structuredClone(this.pub)
  }
  async loadEvent() { return structuredClone(this.event) }
  takeOverResult: 'ok' | 'busy' | 'upcoming' = 'ok'
  tookOver: string[] = []
  async takeOverPost(postId: string, url: string) {
    if (this.takeOverResult !== 'ok') return this.takeOverResult
    this.tookOver.push(postId); this.pub.externalId = postId; this.pub.url = url
    return 'ok' as const
  }
  async loadEventbriteLink() { return this.eventbriteLink }
  async recordCreated(externalId: string, url: string) { this.write(); this.pub.externalId = externalId; this.pub.url = url }
  async saveMeta(meta: Meta) { this.write(); this.pub.meta = { ...meta } }
  async succeed(status: Publication['status'], meta: Meta) {
    this.write()
    this.pub.status = status; this.pub.meta = { ...meta }; this.locked = false; this.lastError = null; this.needsCheck = false
  }
  async fail(message: string, opts: { needsCheck?: boolean; meta?: Meta }) {
    if (this.failNextFail) { this.failNextFail = false; throw new Error('database unavailable') }
    this.lastError = message
    if (opts.meta) this.pub.meta = { ...opts.meta }
    if (opts.needsCheck) this.needsCheck = true
    else this.locked = false
  }
  async loadCover(path: string) { return { bytes: new Uint8Array([1, 2, 3]), contentType: path.endsWith('.png') ? 'image/png' : 'image/jpeg' } }
  async markEventPublished() { this.write(); this.eventPublished = true }
  eventCancelled = false
  async markEventCancelled() {
    this.write()
    if (this.failMarkCancelled) { this.failMarkCancelled = false; throw new Error('database unavailable') }
    this.eventCancelled = true; this.event = { ...this.event, status: 'cancelled' }
  }
}
