import { beforeEach, describe, expect, it } from 'vitest'
import { eventDetails, postContent, syncToWordPress, takeDownFromWordPress } from './sync.ts'
import { WordPressError } from './types.ts'
import type { PostStatus, WordPressApi } from './types.ts'
import { FakeStore } from '../eventbrite/fake-store.ts'
import { inPersonEvent } from '../eventbrite/fixtures.ts'

type Failure = 'refused' | 'lost' | 'unclear' | 'signed_out'

// A fake WordPress that keeps its own posts, records calls, and can fail a step once.
// It deliberately has no way to delete: the dashboard must never delete posts.
class FakeWordPress implements WordPressApi {
  calls: string[] = []
  lastUpdate: Record<string, unknown> | null = null
  posts = new Map<string, { title: string; content: string; status: string; acf?: Record<string, string> }>()
  failures = new Map<string, Failure>()
  private n = 0

  failNext(name: string, how: Failure) { this.failures.set(name, how) }

  private async step<T>(name: string, act: () => T): Promise<T> {
    this.calls.push(name)
    const failure = this.failures.get(name)
    this.failures.delete(name)
    if (failure === 'refused') throw new WordPressError(403, 'Sorry, you are not allowed to do that.', 'rest_forbidden')
    if (failure === 'unclear') throw new WordPressError(502, 'Bad gateway')
    if (failure === 'signed_out') throw new WordPressError(401, 'Sorry, you are not allowed to do that.', 'rest_not_logged_in')
    const result = act()
    if (failure === 'lost') throw new TypeError('network connection lost')
    return result
  }

  createPost(post: { title: string; content: string; status: PostStatus; acf?: Record<string, string> }) {
    return this.step('create', () => {
      const id = String(++this.n)
      this.posts.set(id, { ...post })
      return { id, link: `https://site.test/?post_type=events&p=${id}` }
    })
  }
  updatePost(id: string, fields: { title?: string; content?: string; status?: PostStatus; acf?: Record<string, string> }) {
    return this.step(`update${fields.content === undefined ? ':' + fields.status : ''}`, () => {
      this.lastUpdate = { ...fields }
      Object.assign(this.posts.get(id)!, fields)
    })
  }
  getPostStatus(id: string) { return this.step('getStatus', () => this.posts.get(id)?.status ?? 'gone') }
  getPost(id: string) {
    return this.step('getPost', () => {
      const p = this.posts.get(id)
      return p ? { status: p.status, link: `https://site.test/events/${id}/` } : null
    })
  }
}

const EVENTBRITE_URL = 'https://www.eventbrite.ie/e/123'
let wp: FakeWordPress
let store: FakeStore
const sync = (postStatus: PostStatus = 'draft') => syncToWordPress(wp, store, { postStatus })
const takeDown = () => takeDownFromWordPress(wp, store)
const later = () => { store.lockStale = true }
const onlyPost = () => [...wp.posts.values()][0]

beforeEach(() => {
  wp = new FakeWordPress()
  store = new FakeStore()
  store.eventbriteLink = { status: 'live', url: EVENTBRITE_URL }
})

describe('postContent', () => {
  it('is the short website text, then the Eventbrite registration link', () => {
    expect(postContent({ ...inPersonEvent, website_text: 'Line one\nLine two\n\nSecond para' }, EVENTBRITE_URL)).toBe(
      '<!-- wp:paragraph -->\n<p>Line one<br>Line two</p>\n<!-- /wp:paragraph -->\n\n' +
      '<!-- wp:paragraph -->\n<p>Second para</p>\n<!-- /wp:paragraph -->\n\n' +
      '<!-- wp:paragraph -->\n<p>Find out more and register <strong><a href="https://www.eventbrite.ie/e/123" ' +
      'target="_blank" rel="noreferrer noopener">here</a></strong></p>\n<!-- /wp:paragraph -->',
    )
  })

  it('escapes HTML in the description and the link', () => {
    const html = postContent({ ...inPersonEvent, website_text: 'Tea & <b>cake</b>' }, 'https://x.test/?a=1&b="2"')
    expect(html).toContain('Tea &amp; &lt;b&gt;cake&lt;/b&gt;')
    expect(html).toContain('href="https://x.test/?a=1&amp;b=&quot;2&quot;"')
  })

  it('never includes the long Eventbrite description', () => {
    const html = postContent({ ...inPersonEvent, description: 'LONG EVENTBRITE TEXT', website_text: 'Short' }, EVENTBRITE_URL)
    expect(html).not.toContain('LONG EVENTBRITE TEXT')
    expect(html).toContain('<p>Short</p>')
  })

  it('keeps bullet points and bold', () => {
    const html = postContent({ ...inPersonEvent, website_text: 'Expect:\n- **Tea**\n- Chats' }, EVENTBRITE_URL)
    expect(html).toContain('<ul class="wp-block-list"><!-- wp:list-item -->\n<li><strong>Tea</strong></li>')
  })

  it('events saved before there was website text use the description', () => {
    expect(postContent({ ...inPersonEvent, website_text: null, description: 'Older event' }, EVENTBRITE_URL)).toContain('<p>Older event</p>')
  })

  it('never includes the venue name or street address', () => {
    const html = postContent(inPersonEvent, EVENTBRITE_URL)
    expect(html).not.toContain('Main St')
    expect(html).not.toContain('Community Centre')
  })
})

describe('syncToWordPress: first time', () => {
  it('creates a draft post with the title and content, and records it', async () => {
    const result = await sync()
    expect(result.ok).toBe(true)
    expect(wp.calls).toEqual(['create'])
    expect(onlyPost()).toEqual({
      title: inPersonEvent.title, content: postContent(inPersonEvent, EVENTBRITE_URL), status: 'draft', acf: eventDetails(inPersonEvent),
    })
  })

  it('uses the website title when there is one', async () => {
    store.event = { ...inPersonEvent, title: 'Mayo - Support Group (in-person)', website_title: 'Support Group – Mayo' }
    await sync()
    expect(onlyPost().title).toBe('Support Group – Mayo')
    expect(store.pub.externalId).toBe('1')
    expect(store.pub.status).toBe('draft')
    expect(store.locked).toBe(false)
  })

  it('publishes only when told to, and then records it as live', async () => {
    await sync('publish')
    expect(onlyPost().status).toBe('publish')
    expect(store.pub.status).toBe('live')
  })

  it('does nothing until the event is live on Eventbrite', async () => {
    for (const link of [null, { status: 'draft' as const, url: EVENTBRITE_URL }, { status: 'live' as const, url: null }]) {
      store.eventbriteLink = link
      expect((await sync()).ok).toBe(false)
    }
    expect(wp.calls).toEqual([])
    expect(store.locked).toBe(false)
  })

  it('never posts a cancelled event', async () => {
    store.event = { ...inPersonEvent, status: 'cancelled' }
    expect((await sync()).ok).toBe(false)
    expect(wp.calls).toEqual([])
    expect(store.locked).toBe(false)
  })

  it('does nothing while another save is in progress', async () => {
    store.locked = true
    expect((await sync()).ok).toBe(false)
    expect(wp.calls).toEqual([])
  })
})

describe('syncToWordPress: saving again', () => {
  it('updates the same post instead of creating another', async () => {
    await sync()
    wp.calls = []
    store.event = { ...inPersonEvent, title: 'New title' }
    expect((await sync()).ok).toBe(true)
    expect(wp.calls).toEqual(['getStatus', 'update'])
    expect(wp.posts.size).toBe(1)
    expect(onlyPost().title).toBe('New title')
  })

  it('leaves a post alone if it was removed in WordPress, and notes it (not an error)', async () => {
    await sync('publish')
    onlyPost().status = 'trash'
    wp.calls = []
    expect((await sync('publish')).ok).toBe(true)
    expect(wp.calls).toEqual(['getStatus'])
    expect(store.pub.meta.note).toMatch(/removed/i)
    expect(store.pub.status).toBe('draft') // not "Posted on the website"
    expect(store.lastError).toBeNull()
    expect(store.locked).toBe(false)
  })

  it('never changes the post’s status on an ordinary update', async () => {
    await sync()
    await sync()
    expect(wp.lastUpdate).not.toHaveProperty('status')
  })

  it('if Ciara published the draft herself, saving still updates the details but leaves the status to her', async () => {
    await sync()
    onlyPost().status = 'publish'
    store.event = { ...inPersonEvent, title: 'Time changed' }
    wp.calls = []
    expect((await sync()).ok).toBe(true)
    expect(wp.calls).toEqual(['getStatus', 'update'])
    expect(wp.lastUpdate).not.toHaveProperty('status')
    expect(onlyPost()).toMatchObject({ title: 'Time changed', status: 'publish' })
    expect(store.pub.status).toBe('live')
    expect(store.pub.meta.note).toMatch(/status/i)
  })

  it('if Ciara hid a published post herself, saving never puts it back up', async () => {
    await sync('publish')
    for (const hidden of ['draft', 'private', 'pending']) {
      onlyPost().status = hidden
      expect((await sync('publish')).ok).toBe(true)
      expect(wp.lastUpdate).not.toHaveProperty('status')
      expect(onlyPost().status).toBe(hidden)
    }
  })

  it('once Ciara has changed the status, the dashboard never changes it again, even after she changes it back', async () => {
    await sync('draft')
    onlyPost().status = 'publish' // she publishes it
    await sync('draft')
    onlyPost().status = 'draft' // later she hides it again
    await sync('publish') // the dashboard is now in "go live" mode
    expect(onlyPost().status).toBe('draft')
    expect(wp.lastUpdate).not.toHaveProperty('status')
  })

  it('if WordPress won’t accept updates to a post she published, she is told clearly', async () => {
    await sync()
    onlyPost().status = 'publish'
    wp.failNext('update', 'refused')
    const result = await sync()
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.message).toMatch(/wasn’t updated/)
    expect(store.lastError).toMatch(/wasn’t updated/)
    expect(store.locked).toBe(false)
  })

  it('if the dashboard can’t sign in to WordPress, it says so', async () => {
    wp.failNext('create', 'signed_out')
    const result = await sync()
    expect(result.ok === false && result.message).toMatch(/can’t sign in to WordPress/)
  })

  it('when going live, a draft the dashboard made is switched to published', async () => {
    await sync('draft')
    await sync('publish')
    expect(wp.lastUpdate).toMatchObject({ status: 'publish' })
    expect(onlyPost().status).toBe('publish')
    expect(store.pub.status).toBe('live')
  })

  it('an ordinary update clears an earlier note', async () => {
    await sync()
    store.pub.meta = { ...store.pub.meta, note: 'old note' }
    await sync()
    expect(store.pub.meta.note ?? null).toBeNull()
  })
})

describe('syncToWordPress: safety of what is sent', () => {
  it('escapes the title', async () => {
    store.event = { ...inPersonEvent, title: 'Tea & <Talk>' }
    await sync()
    expect(onlyPost().title).toBe('Tea &amp; &lt;Talk&gt;')
  })

  it('only links to Eventbrite', async () => {
    for (const url of ['javascript:alert(1)', 'http://www.eventbrite.ie/e/1', 'https://evil.test/e/1',
      'https://www.eventbrite.evil.com/e/1', 'https://eventbrite.ie.evil.com/e/1']) {
      store.eventbriteLink = { status: 'live', url }
      expect((await sync()).ok).toBe(false)
    }
    expect(wp.calls).toEqual([])
  })

  it('the duplicate check asks her to look in drafts and published, and bin any copy', async () => {
    wp.failNext('create', 'lost')
    const result = await sync()
    expect(result.ok === false && result.message).toMatch(/drafts and published/)
    expect(result.ok === false && result.message).toMatch(/Bin/)
  })
})

describe('syncToWordPress: never a duplicate post', () => {
  it('if WordPress clearly refuses, nothing was created and a retry creates one post', async () => {
    wp.failNext('create', 'refused')
    expect((await sync()).ok).toBe(false)
    expect(store.needsCheck).toBe(false)
    expect(store.locked).toBe(false)
    expect((await sync()).ok).toBe(true)
    expect(wp.posts.size).toBe(1)
  })

  it('if WordPress created it but the reply was lost, it asks for a check instead of retrying', async () => {
    wp.failNext('create', 'lost')
    const result = await sync()
    expect(result.ok === false && result.message).toMatch(/check/i)
    expect(store.needsCheck).toBe(true)
    later()
    await sync()
    expect(wp.posts.size).toBe(1)
  })

  it('an unclear error (502) while creating is treated the same way', async () => {
    wp.failNext('create', 'unclear')
    await sync()
    expect(store.needsCheck).toBe(true)
  })

  it('if the post was created but its id could not be recorded, it asks for a check', async () => {
    store.failNextWrite = true
    await sync()
    expect(store.needsCheck).toBe(true)
    later()
    await sync()
    expect(wp.posts.size).toBe(1)
  })
})

describe('takeDownFromWordPress (when the event is cancelled)', () => {
  it('an event never posted just records it', async () => {
    expect((await takeDown()).ok).toBe(true)
    expect(wp.calls).toEqual([])
    expect(store.pub.status).toBe('cancelled')
  })

  it('switches the post back to a hidden draft, never deletes it', async () => {
    await sync('publish')
    wp.calls = []
    expect((await takeDown()).ok).toBe(true)
    expect(wp.calls).toEqual(['getStatus', 'update:draft'])
    expect(onlyPost().status).toBe('draft')
    expect(wp.posts.size).toBe(1)
    expect(store.pub.status).toBe('cancelled')
  })

  it('a post already hidden or removed in WordPress is left alone', async () => {
    for (const status of ['draft', 'trash', 'gone']) {
      store = new FakeStore()
      wp = new FakeWordPress()
      store.eventbriteLink = { status: 'live', url: EVENTBRITE_URL }
      await sync()
      if (status === 'gone') wp.posts.clear()
      else onlyPost().status = status
      wp.calls = []
      expect((await takeDown()).ok).toBe(true)
      expect(wp.calls).toEqual(['getStatus'])
      expect(store.pub.status).toBe('cancelled')
    }
  })

  it('if the reply was lost, it checks WordPress and records the take-down', async () => {
    await sync('publish')
    wp.failNext('update:draft', 'lost')
    expect((await takeDown()).ok).toBe(true)
    expect(store.pub.status).toBe('cancelled')
  })

  it('if WordPress refuses, the post is still up and she is told to hide it herself', async () => {
    await sync('publish')
    wp.failNext('update:draft', 'refused')
    const result = await takeDown()
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.message).toMatch(/switch this post to Draft in WordPress yourself/)
    expect(onlyPost().status).toBe('publish')
    expect(store.pub.status).toBe('live')
    expect(store.locked).toBe(false)
  })

  it('if the dashboard can’t sign in, take-down says so rather than blaming permissions', async () => {
    await sync('publish')
    wp.failNext('update:draft', 'signed_out')
    const result = await takeDown()
    expect(result.ok === false && result.message).toMatch(/can’t sign in to WordPress/)
  })

  it('a post Ciara published herself is still taken down when the event is cancelled', async () => {
    await sync('draft')
    onlyPost().status = 'publish'
    wp.calls = []
    expect((await takeDown()).ok).toBe(true)
    expect(wp.calls).toEqual(['getStatus', 'update:draft'])
    expect(onlyPost().status).toBe('draft')
  })

  it('after taking down, saving never puts the post back up', async () => {
    await sync('publish')
    store.event = { ...inPersonEvent, status: 'cancelled' }
    await takeDown()
    wp.calls = []
    expect((await sync('publish')).ok).toBe(false)
    expect(wp.calls).toEqual([])
    expect(onlyPost().status).toBe('draft')
  })
})

describe('the event card details (date, times, location)', () => {
  // inPersonEvent: 10:00–12:00 UTC on 10 Oct 2026 = 11:00–13:00 Irish summer time, area "Castlebar".
  it('are the Irish date and times, and the area as the location', () => {
    expect(eventDetails(inPersonEvent)).toEqual({
      event_date: '20261010',
      event_start_time: '11:00:00',
      event_end_time: '13:00:00',
      event_location: 'Castlebar',
    })
  })

  it('use the location written for the website when there is one', () => {
    expect(eventDetails({ ...inPersonEvent, website_location: ' Castlebar, Co. Mayo ' }).event_location).toBe('Castlebar, Co. Mayo')
  })

  it('say "Online" for an online event with no location written', () => {
    expect(eventDetails({ ...inPersonEvent, is_online: true, public_area: null }).event_location).toBe('Online')
    expect(eventDetails({ ...inPersonEvent, is_online: true, public_area: null, website_location: 'Online (Weekly)' }).event_location)
      .toBe('Online (Weekly)')
  })

  it('never include the venue name or street address, or the Text field', () => {
    const json = JSON.stringify(eventDetails(inPersonEvent))
    expect(json).not.toContain('Main St')
    expect(json).not.toContain('Community Centre')
    expect(eventDetails(inPersonEvent)).not.toHaveProperty('Text')
  })

  it('are sent with every update, so a time change reaches the card', async () => {
    await sync()
    store.event = { ...inPersonEvent, starts_at: '2026-10-10T17:30:00+00:00', ends_at: '2026-10-10T19:00:00+00:00' }
    await sync()
    expect(wp.lastUpdate?.acf).toMatchObject({ event_start_time: '18:30:00', event_end_time: '20:00:00' })
  })

  it('are still kept up to date after Ciara has taken over the post’s status', async () => {
    await sync()
    onlyPost().status = 'publish'
    store.event = { ...inPersonEvent, website_location: 'Westport, Co. Mayo' }
    await sync()
    expect(wp.lastUpdate).not.toHaveProperty('status')
    expect(wp.lastUpdate?.acf).toMatchObject({ event_location: 'Westport, Co. Mayo' })
  })
})

describe('reusing an existing website post', () => {
  const HER_POST = '900'
  beforeEach(() => {
    wp.posts.set(HER_POST, { title: 'Support Group – Mayo', content: 'old text', status: 'publish' })
    store.event = { ...inPersonEvent, website_post_id: HER_POST }
  })

  it('updates the chosen post instead of creating a new one', async () => {
    expect((await sync('publish')).ok).toBe(true)
    expect(wp.calls).toEqual(['getPost', 'update'])
    expect(wp.posts.size).toBe(1)
    expect(wp.posts.get(HER_POST)).toMatchObject({
      title: inPersonEvent.title,
      content: postContent(store.event, EVENTBRITE_URL),
      acf: eventDetails(store.event),
      status: 'publish',
    })
    expect(store.tookOver).toEqual([HER_POST])
    expect(store.pub.externalId).toBe(HER_POST)
    expect(store.pub.status).toBe('live')
  })

  it('while testing (draft mode), never touches a live post at all', async () => {
    const result = await sync('draft')
    expect(result.ok === false && result.message).toMatch(/publish mode/)
    expect(wp.calls).toEqual(['getPost'])
    expect(wp.posts.get(HER_POST)).toMatchObject({ title: 'Support Group – Mayo', content: 'old text', status: 'publish' })
    expect(store.tookOver).toEqual([])
    expect(store.locked).toBe(false)
  })

  it('while testing (draft mode), a hidden post can be reused and stays hidden', async () => {
    wp.posts.get(HER_POST)!.status = 'draft'
    expect((await sync('draft')).ok).toBe(true)
    expect(wp.posts.get(HER_POST)).toMatchObject({ title: inPersonEvent.title, status: 'draft' })
    expect(wp.lastUpdate).not.toHaveProperty('status')
  })

  it('in publish mode, a post hidden after an earlier cancellation is put back up', async () => {
    wp.posts.get(HER_POST)!.status = 'draft'
    await sync('publish')
    expect(wp.posts.get(HER_POST)!.status).toBe('publish')
  })

  it('refuses a post that is in the Bin or no longer exists, and never creates one instead', async () => {
    wp.posts.get(HER_POST)!.status = 'trash'
    expect((await sync('publish')).ok).toBe(false)
    wp.posts.delete(HER_POST)
    const result = await sync('publish')
    expect(result.ok === false && result.message).toMatch(/choose another/i)
    expect(wp.calls).not.toContain('create')
    expect(wp.calls).not.toContain('update')
    expect(store.tookOver).toEqual([])
    expect(store.locked).toBe(false)
  })

  it('waits if another event is updating that post right now', async () => {
    store.takeOverResult = 'busy'
    expect((await sync('publish')).ok).toBe(false)
    expect(wp.calls).toEqual(['getPost'])
    expect(store.locked).toBe(false)
  })

  it('if WordPress won’t let the dashboard edit the post, says to change its author', async () => {
    wp.failNext('update', 'refused')
    const result = await sync('publish')
    expect(result.ok === false && result.message).toMatch(/Author.*Events Dashboard/)
    expect(store.locked).toBe(false)
  })

  it('if WordPress won’t even show the dashboard the post (author not changed yet), says so', async () => {
    wp.failNext('getPost', 'refused')
    const result = await sync('publish')
    expect(result.ok === false && result.message).toMatch(/Author.*Events Dashboard/)
    expect(store.tookOver).toEqual([])
  })

  it('once taken over, later saves update the same post', async () => {
    await sync('publish')
    wp.calls = []
    store.event = { ...store.event, title: 'Changed' }
    await sync('publish')
    expect(wp.calls).toEqual(['getStatus', 'update'])
    expect(wp.posts.get(HER_POST)!.title).toBe('Changed')
  })

  it('cancelling the event hides the reused post until it is reused again', async () => {
    await sync('publish')
    store.event = { ...store.event, status: 'cancelled' }
    expect((await takeDown()).ok).toBe(true)
    expect(wp.posts.get(HER_POST)!.status).toBe('draft')
    expect(wp.posts.size).toBe(1)
  })
})

describe('an event whose post was reused by a later event', () => {
  beforeEach(() => {
    store.pub = { externalId: null, url: null, status: 'not_started', meta: { handedOver: true, handedOverChoice: '900' } }
    store.event = { ...inPersonEvent, website_post_id: '900' }
  })

  it('never posts again when saved', async () => {
    expect((await sync('publish')).ok).toBe(true)
    expect(wp.calls).toEqual([])
    expect(store.locked).toBe(false)
  })

  it('never hides the post when cancelled', async () => {
    store.event = { ...inPersonEvent, status: 'cancelled' }
    expect((await takeDown()).ok).toBe(true)
    expect(wp.calls).toEqual([])
  })
})

describe('reusing a post: safety checks', () => {
  const HER_POST = '900'
  beforeEach(() => {
    wp.posts.set(HER_POST, { title: 'Support Group – Mayo', content: 'old text', status: 'publish' })
    store.event = { ...inPersonEvent, website_post_id: HER_POST }
  })

  it('never takes a post from a session that hasn’t happened yet', async () => {
    store.takeOverResult = 'upcoming'
    const result = await sync('publish')
    expect(result.ok === false && result.message).toMatch(/upcoming session/)
    expect(wp.calls).not.toContain('update')
    expect(store.locked).toBe(false)
  })

  it('only accepts a plain post number', async () => {
    for (const bad of ['123?status=publish', '123/revisions', '../users/me', '', ' 12']) {
      store.event = { ...inPersonEvent, website_post_id: bad || 'x' }
      expect((await sync('publish')).ok).toBe(false)
    }
    expect(wp.calls).toEqual([])
  })

  it('won’t reuse a private or pending post', async () => {
    for (const status of ['private', 'pending']) {
      wp.posts.get(HER_POST)!.status = status
      expect((await sync('publish')).ok).toBe(false)
    }
    expect(wp.calls).not.toContain('update')
  })
})

describe('an event that handed its post over can choose again', () => {
  beforeEach(() => {
    wp.posts.set('901', { title: 'Support Group – Mayo (2)', content: 'x', status: 'publish' })
    store.pub = { externalId: null, url: null, status: 'not_started', meta: {
      handedOver: true, handedOverChoice: '900', lastSetStatus: 'publish', statusOwnedByCiara: true, reused: true,
    } }
  })

  it('choosing a different post starts afresh', async () => {
    store.event = { ...inPersonEvent, website_post_id: '901' }
    expect((await sync('publish')).ok).toBe(true)
    expect(store.tookOver).toEqual(['901'])
    expect(store.pub.meta.handedOver).toBeFalsy()
    expect(store.pub.meta.statusOwnedByCiara).toBe(false)
  })

  it('choosing "create a new post" creates one', async () => {
    store.event = { ...inPersonEvent, website_post_id: null }
    expect((await sync('publish')).ok).toBe(true)
    expect(wp.calls).toContain('create')
    expect(store.pub.meta.handedOver).toBeFalsy()
  })

  it('an event handed over before its choice was recorded never takes a post back', async () => {
    store.pub.meta = { handedOver: true }
    store.event = { ...inPersonEvent, website_post_id: '901' }
    expect((await sync('publish')).ok).toBe(true)
    expect(wp.calls).toEqual([])
    expect(store.tookOver).toEqual([])
  })

  it('leaving the same post chosen does nothing, and says why', async () => {
    store.event = { ...inPersonEvent, website_post_id: '900' }
    expect((await sync('publish')).ok).toBe(true)
    expect(wp.calls).toEqual([])
    expect(store.pub.meta.note).toMatch(/reused for a later event/)
  })
})

