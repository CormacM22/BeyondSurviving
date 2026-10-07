// Publishing an event to the Events section of the WordPress site.
//
// The post matches Ciara's own event posts: her description, then "Find out
// more and register here" linking to the Eventbrite event. It's only created
// once the event is live on Eventbrite (the link has to work), and uses the
// same rules as Eventbrite for never creating a duplicate. Cancelling switches
// the post back to a hidden draft: the dashboard never deletes posts.

import { formatWordPressBlocks } from '../format.ts'
import { dublinDateTime } from '../dublin.ts'
import type { EventRecord, Meta, PublicationStore, Result } from '../eventbrite/types.ts'
import { WordPressError } from './types.ts'
import type { EventDetails, PostStatus, WordPressApi } from './types.ts'

const BUSY = 'The website post is already being updated. Please wait a moment and refresh.'
const NEEDS_CHECK =
  'WordPress may have created the website post, but the dashboard couldn’t confirm it. ' +
  'Please check Events in WordPress (drafts and published) for a copy of this event. ' +
  'If there is one, move it to the Bin, then press the button below.'
const DO_IT_YOURSELF =
  'The dashboard isn’t allowed to change this post. Please switch this post to Draft in WordPress yourself ' +
  '(Events → this post → Status: Draft), then press the button below.'
const OWNED_REFUSED =
  'The website post wasn’t updated: WordPress won’t let the dashboard change a post you published yourself. ' +
  'Please update it in WordPress, or ask Cormac to raise the dashboard’s WordPress role to Author.'
const SIGNED_OUT =
  'The dashboard can’t sign in to WordPress (its Application Password may have been revoked). Please tell Cormac.'
const REUSE_GONE =
  'The website post chosen for this event is in the Bin or no longer exists. ' +
  'Please choose another post, or create a new one.'
const REUSE_LIVE_IN_TEST =
  'That post is live on the website. While the dashboard is in testing mode it only updates hidden posts, ' +
  'so it never changes what the public sees. Live posts can be reused once it’s switched to publish mode.'
const REUSE_UPCOMING =
  'That post is still being used for an upcoming session, so the dashboard won’t replace it. ' +
  'Choose another post (one whose session has passed) or create a new one, or wait until that session ' +
  'has passed and then press “Update the website”.'
const REUSE_UNSUITABLE = 'That post is private or waiting for review, so it can’t be reused. Please choose another post.'
const REUSE_BAD_ID = 'The chosen website post isn’t valid. Please choose the post again.'
const REUSE_BUSY = 'That website post is being updated for another event right now. Please try again in a moment.'
const REUSE_REFUSED =
  'WordPress won’t let the dashboard edit the chosen post. In WordPress, set this post’s Author to ' +
  'Events Dashboard (Events → the post → Author), then press the button below.'
// Eventbrite's own event pages only: exact hosts, so look-alikes don't pass.
const EVENTBRITE_LINK = /^https:\/\/(www\.)?eventbrite\.(com|ie|co\.uk)\//i
const GENERIC = 'Couldn’t finish updating the website. Please try again.'

// Statuses in which visitors can't see the post.
const HIDDEN = new Set(['draft', 'pending', 'private', 'trash', 'auto-draft', 'gone'])

function userMessage(e: unknown): string {
  if (e instanceof WordPressError && e.status === 401) return SIGNED_OUT
  if (e instanceof WordPressError) return `WordPress said: ${e.message}`
  console.error(e)
  return GENERIC
}

const escapeText = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
const escapeAttr = (s: string) =>
  s.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

const paragraph = (inner: string) => `<!-- wp:paragraph -->\n${inner}\n<!-- /wp:paragraph -->`

/**
 * The post body, in WordPress block markup: the short website text (the long
 * description is Eventbrite's), then the registration link. Never venue details.
 */
export function postContent(ev: EventRecord, eventbriteUrl: string): string {
  // Events saved before there was a website text fall back to the description.
  const text = ev.website_text?.trim() ? ev.website_text : ev.description
  const register = paragraph(
    `<p>Find out more and register <strong><a href="${escapeAttr(eventbriteUrl)}" ` +
      'target="_blank" rel="noreferrer noopener">here</a></strong></p>',
  )
  return [formatWordPressBlocks(text), register].join('\n\n')
}

/**
 * The date, times and location shown on the website's event card ("What's coming
 * up?"). The location is the line written for the website, else the area (or
 * "Online"): never the venue name or street address.
 */
export function eventDetails(ev: EventRecord): EventDetails {
  const start = dublinDateTime(ev.starts_at)
  const end = dublinDateTime(ev.ends_at)
  return {
    event_date: start.date,
    event_start_time: start.time,
    event_end_time: end.time,
    event_location: ev.website_location?.trim() || (ev.is_online ? 'Online' : ev.public_area ?? ''),
  }
}

/** Creates the website post the first time; updates it after that. */
export async function syncToWordPress(
  api: WordPressApi,
  store: PublicationStore,
  opts: { postStatus: PostStatus },
): Promise<Result> {
  const claim = await store.claim()
  if (claim === 'busy') return { ok: false, message: BUSY }
  if (claim === 'needs_check') return { ok: false, message: NEEDS_CHECK }

  const meta: Meta = { ...claim.meta }
  const release = async (message: string): Promise<Result> => {
    await store.fail(message, { meta })
    return { ok: false, message }
  }
  const holdForCheck = async (): Promise<Result> => {
    await store.fail(NEEDS_CHECK, { needsCheck: true, meta })
    return { ok: false, message: NEEDS_CHECK }
  }
  // As in the Eventbrite step: once WordPress may have created an unrecorded
  // post, the lock must never be released, even if flagging the row fails.
  let mayExistUnrecorded = false

  try {
    const ev = await store.loadEvent()

    // This event's post was reused by a later event. Unless Ciara has since changed
    // this event's post choice, never touch it again.
    if (claim.externalId === null && meta.handedOver) {
      // (Handed over before the choice was recorded: treat as unchanged, never reclaim.)
      if (meta.handedOverChoice === undefined || (ev.website_post_id ?? '') === meta.handedOverChoice) {
        meta.note = 'This event’s website post was reused for a later event, so this event no longer changes it. ' +
          'Choose another post (or a new one) to post it again.'
        await store.succeed(claim.status, meta)
        return { ok: true, url: null }
      }
      for (const k of ['handedOver', 'handedOverChoice', 'lastSetStatus', 'statusOwnedByCiara', 'reused', 'note'] as const) delete meta[k]
    }

    if (ev.status === 'cancelled' || claim.status === 'cancelled') {
      return release('This event is cancelled, so it isn’t posted on the website.')
    }
    const link = await store.loadEventbriteLink()
    if (!link || link.status !== 'live' || !link.url) {
      return release('The website post is created once the event is live on Eventbrite.')
    }
    if (!EVENTBRITE_LINK.test(link.url)) return release('The Eventbrite link doesn’t look right, so nothing was posted.')

    const title = escapeText(ev.website_title?.trim() || ev.title)
    const content = postContent(ev, link.url)
    const acf = eventDetails(ev)
    let url = claim.url
    // What the dashboard records: WordPress's actual status, not what it asked for.
    const recorded = (status: string) => (status === 'publish' ? 'live' : 'draft')

    let externalId = claim.externalId
    let current: string

    if (externalId === null && ev.website_post_id) {
      // Reuse one of Ciara's existing posts (as she does by hand) instead of creating one.
      // The id goes into a WordPress address, so it must be a plain post number.
      if (!/^\d+$/.test(ev.website_post_id)) return await release(REUSE_BAD_ID)
      let post: { status: string; link: string } | null
      try {
        post = await api.getPost(ev.website_post_id)
      } catch (e) {
        // WordPress hides other authors' posts from the dashboard until the author is changed.
        if (e instanceof WordPressError && e.definitelyRefused && e.status !== 401) return await release(REUSE_REFUSED)
        throw e
      }
      if (!post || post.status === 'trash') return await release(REUSE_GONE)
      if (post.status !== 'publish' && post.status !== 'draft') return await release(REUSE_UNSUITABLE)
      // Testing mode must never change anything the public can see.
      if (post.status === 'publish' && opts.postStatus !== 'publish') return await release(REUSE_LIVE_IN_TEST)
      const taken = await store.takeOverPost(ev.website_post_id, post.link)
      if (taken === 'busy') return await release(REUSE_BUSY)
      if (taken === 'upcoming') return await release(REUSE_UPCOMING)
      externalId = ev.website_post_id
      url = post.link
      current = post.status
      // Choosing to reuse it is Ciara's explicit say-so: the dashboard looks after it from here.
      meta.lastSetStatus = post.status
      meta.statusOwnedByCiara = false
      meta.reused = true
    } else if (externalId === null) {
      let created: { id: string; link: string }
      try {
        created = await api.createPost({ title, content, status: opts.postStatus, acf })
      } catch (e) {
        if (e instanceof WordPressError && e.definitelyRefused) return await release(userMessage(e))
        console.error(e)
        mayExistUnrecorded = true
        return await holdForCheck()
      }
      try {
        await store.recordCreated(created.id, created.link)
      } catch (e) {
        console.error(e)
        mayExistUnrecorded = true
        return await holdForCheck()
      }
      url = created.link
      meta.lastSetStatus = opts.postStatus
      meta.note = null
      await store.succeed(recorded(opts.postStatus), meta)
      return { ok: true, url }
    } else {
      current = await api.getPostStatus(externalId)
    }

    // If Ciara removed the post, respect that: never bring it back.
    if (current === 'trash' || current === 'gone') {
      meta.note = 'This post was removed in WordPress, so the dashboard is leaving it alone.'
      await store.succeed('draft', meta)
      return { ok: true, url }
    }
    // If she has ever changed its status herself (published it, hid it…), the
    // status is hers from then on, for good. The details are still kept up to date.
    if (current !== (meta.lastSetStatus ?? 'draft')) meta.statusOwnedByCiara = true

    const fields: { title: string; content: string; status?: PostStatus; acf: EventDetails } = { title, content, acf }
    // The only status change an update ever makes is putting a post up, and only in
    // publish mode. So while testing (draft mode) a live post is never unpublished;
    // posts are only hidden by takeDownFromWordPress when an event is cancelled.
    if (!meta.statusOwnedByCiara && opts.postStatus === 'publish' && current !== 'publish') fields.status = 'publish'
    try {
      await api.updatePost(externalId, fields)
    } catch (e) {
      const refused = e instanceof WordPressError && e.definitelyRefused && e.status !== 401
      if (meta.statusOwnedByCiara && refused) return await release(OWNED_REFUSED)
      if (meta.reused && refused) return await release(REUSE_REFUSED)
      throw e
    }
    if (fields.status) meta.lastSetStatus = fields.status
    meta.note = meta.statusOwnedByCiara
      ? 'You changed this post’s status in WordPress, so the dashboard keeps its details up to date but leaves the status to you.'
      : null
    await store.succeed(recorded(fields.status ?? current), meta)
    return { ok: true, url }
  } catch (e) {
    if (mayExistUnrecorded) throw e
    return await release(userMessage(e))
  }
}

/** Takes the website post down (back to a hidden draft) when the event is cancelled. Never deletes it. */
export async function takeDownFromWordPress(api: WordPressApi, store: PublicationStore): Promise<Result> {
  const claim = await store.claim()
  if (claim === 'busy') return { ok: false, message: BUSY }
  if (claim === 'needs_check') return { ok: false, message: NEEDS_CHECK }

  const release = async (message: string): Promise<Result> => {
    await store.fail(message, {})
    return { ok: false, message }
  }

  try {
    if (claim.externalId !== null) {
      const current = await api.getPostStatus(claim.externalId)
      if (!HIDDEN.has(current)) {
        try {
          await api.updatePost(claim.externalId, { status: 'draft' })
        } catch (e) {
          // The reply may have been lost after it worked: check before reporting a failure.
          const after = await api.getPostStatus(claim.externalId).catch(() => 'unknown')
          if (!HIDDEN.has(after)) {
            // A clear refusal is a permissions problem (e.g. she published it and the
            // dashboard's role can't edit published posts): she has to do it herself.
            const refused = e instanceof WordPressError && e.definitelyRefused && e.status !== 401
            return await release(refused ? DO_IT_YOURSELF : userMessage(e))
          }
        }
      }
    }
    await store.succeed('cancelled', { ...claim.meta, note: null })
    return { ok: true, url: claim.url }
  } catch (e) {
    return await release(userMessage(e))
  }
}
