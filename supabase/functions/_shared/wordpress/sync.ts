// Publishing an event to the Events section of the WordPress site.
//
// The post matches Ciara's own event posts: her description, then "Find out
// more and register here" linking to the Eventbrite event. It's only created
// once the event is live on Eventbrite (the link has to work), and uses the
// same rules as Eventbrite for never creating a duplicate. Cancelling switches
// the post back to a hidden draft: the dashboard never deletes posts.

import { descriptionHtml } from '../eventbrite/payload.ts'
import type { EventRecord, Meta, PublicationStore, Result } from '../eventbrite/types.ts'
import { WordPressError } from './types.ts'
import type { PostStatus, WordPressApi } from './types.ts'

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

/** The post body, in WordPress block markup. Only the description and the link: never venue details. */
export function postContent(ev: EventRecord, eventbriteUrl: string): string {
  const paragraphs = descriptionHtml(ev.description).split('</p>').filter(Boolean).map((p) => paragraph(`${p}</p>`))
  const register = paragraph(
    `<p>Find out more and register <strong><a href="${escapeAttr(eventbriteUrl)}" ` +
      'target="_blank" rel="noreferrer noopener">here</a></strong></p>',
  )
  return [...paragraphs, register].join('\n\n')
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
    if (ev.status === 'cancelled' || claim.status === 'cancelled') {
      return release('This event is cancelled, so it isn’t posted on the website.')
    }
    const link = await store.loadEventbriteLink()
    if (!link || link.status !== 'live' || !link.url) {
      return release('The website post is created once the event is live on Eventbrite.')
    }
    if (!EVENTBRITE_LINK.test(link.url)) return release('The Eventbrite link doesn’t look right, so nothing was posted.')

    const title = escapeText(ev.title)
    const content = postContent(ev, link.url)
    let url = claim.url
    // What the dashboard records: WordPress's actual status, not what it asked for.
    const recorded = (status: string) => (status === 'publish' ? 'live' : 'draft')

    if (claim.externalId === null) {
      let created: { id: string; link: string }
      try {
        created = await api.createPost({ title, content, status: opts.postStatus })
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
    }

    const current = await api.getPostStatus(claim.externalId)
    // If Ciara removed the post, respect that: never bring it back.
    if (current === 'trash' || current === 'gone') {
      meta.note = 'This post was removed in WordPress, so the dashboard is leaving it alone.'
      await store.succeed('draft', meta)
      return { ok: true, url }
    }
    // If she has ever changed its status herself (published it, hid it…), the
    // status is hers from then on, for good. The details are still kept up to date.
    if (current !== (meta.lastSetStatus ?? 'draft')) meta.statusOwnedByCiara = true

    const fields: { title: string; content: string; status?: PostStatus } = { title, content }
    // Only ever change the status deliberately (draft → published when going live).
    if (!meta.statusOwnedByCiara && opts.postStatus !== current) fields.status = opts.postStatus
    try {
      await api.updatePost(claim.externalId, fields)
    } catch (e) {
      const refused = e instanceof WordPressError && e.definitelyRefused && e.status !== 401
      if (meta.statusOwnedByCiara && refused) return await release(OWNED_REFUSED)
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
