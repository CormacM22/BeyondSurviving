import { afterEach, describe, expect, it, vi } from 'vitest'
import { wordpressApi } from './api.ts'

type Captured = { url: string; method: string; headers: Record<string, string>; body: unknown }

function stubFetch(status: number, reply: unknown) {
  const requests: Captured[] = []
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    requests.push({
      url, method: init.method ?? 'GET',
      headers: Object.fromEntries(new Headers(init.headers).entries()),
      body: init.body,
    })
    return new Response(JSON.stringify(reply), { status })
  })
  return requests
}

afterEach(() => { vi.unstubAllGlobals() })

const api = () => wordpressApi('https://site.test', 'events-dashboard', 'abcd efgh')

describe('wordpressApi', () => {
  it('signs in with the Application Password (HTTP Basic)', async () => {
    const requests = stubFetch(200, { status: 'draft' })
    await api().getPostStatus('7')
    expect(requests[0].headers.authorization).toBe('Basic ' + btoa('events-dashboard:abcd efgh'))
    expect(requests[0].url).toBe('https://site.test/wp-json/wp/v2/events/7?context=edit&_fields=status')
    expect(requests[0].headers['content-type']).toBeUndefined()
  })

  it('creates a post in the Events section', async () => {
    const requests = stubFetch(201, { id: 42, link: 'https://site.test/?p=42' })
    const acf = { event_date: '20261019', event_start_time: '19:00:00', event_end_time: '20:30:00', event_location: 'Mayo' }
    const created = await api().createPost({ title: 'T', content: 'C', status: 'draft', acf })
    expect(created).toEqual({ id: '42', link: 'https://site.test/?p=42' })
    expect(requests[0].method).toBe('POST')
    expect(requests[0].url).toBe('https://site.test/wp-json/wp/v2/events')
    expect(requests[0].headers['content-type']).toBe('application/json')
    expect(JSON.parse(requests[0].body as string)).toEqual({ title: 'T', content: 'C', status: 'draft', acf })
  })

  it('a create reply without an id counts as unclear, not a refusal', async () => {
    stubFetch(201, {})
    const acf = { event_date: '20261019', event_start_time: '19:00:00', event_end_time: '20:30:00', event_location: 'Mayo' }
    const err = await api().createPost({ title: 'T', content: 'C', status: 'draft', acf }).catch((e) => e)
    expect(err.constructor.name).not.toBe('WordPressError')
  })

  it('updates a post', async () => {
    const requests = stubFetch(200, { id: 42 })
    await api().updatePost('42', { status: 'draft' })
    expect(requests[0].method).toBe('POST')
    expect(requests[0].url).toBe('https://site.test/wp-json/wp/v2/events/42')
    expect(JSON.parse(requests[0].body as string)).toEqual({ status: 'draft' })
  })

  it('a post that no longer exists is reported as gone', async () => {
    stubFetch(404, { code: 'rest_post_invalid_id', message: 'Invalid post ID.' })
    expect(await api().getPostStatus('42')).toBe('gone')
  })

  it('keeps WordPress’s error code and message', async () => {
    stubFetch(403, { code: 'rest_cannot_publish', message: 'Sorry, you are not allowed to publish posts in this post type.' })
    const err = await api().updatePost('42', { status: 'publish' }).catch((e) => e)
    expect(err.status).toBe(403)
    expect(err.code).toBe('rest_cannot_publish')
    expect(err.definitelyRefused).toBe(true)
    expect(err.message).toMatch(/not allowed to publish/)
  })
})

describe('listing existing posts to reuse', () => {
  // Her Events posts don't report an author (the post type doesn't support it), so
  // which ones the dashboard owns comes from WordPress's author filter instead.
  it('lists published Events posts plus the dashboard’s own hidden ones, marking which it may edit', async () => {
    const replies: [string, unknown][] = [
      ['/users/me', { id: 41 }],
      ['/events?status=publish&author=41', [{ id: 6000 }]],
      ['/events?status=publish', [
        { id: 5505, title: { rendered: 'Support Group &#8211; Mayo' }, status: 'publish', acf: { event_date: '20261019', event_location: 'Castlebar, Co. Mayo' } },
        { id: 6000, title: { rendered: 'TEST' }, status: 'publish', acf: { event_date: '20260101', event_location: '' } },
      ]],
      ['/events?status=draft&author=41', [
        { id: 5512, title: { rendered: 'Thursday' }, status: 'draft', acf: { event_date: '20261001', event_location: 'Mayo' } },
      ]],
    ]
    vi.stubGlobal('fetch', async (url: string) => {
      const [, reply] = replies.find(([k]) => url.includes(k))!
      return new Response(JSON.stringify(reply), { status: 200 })
    })
    expect(await api().listEventPosts()).toEqual([
      { id: '5505', title: 'Support Group – Mayo', status: 'publish', eventDate: '20261019', location: 'Castlebar, Co. Mayo', editable: false },
      { id: '6000', title: 'TEST', status: 'publish', eventDate: '20260101', location: '', editable: true },
      { id: '5512', title: 'Thursday', status: 'draft', eventDate: '20261001', location: 'Mayo', editable: true },
    ])
  })
})

describe('listing posts across pages', () => {
  it('stops cleanly when there are exactly 100 posts', async () => {
    const hundred = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, title: { rendered: `P${i + 1}` }, status: 'publish', author: 2, acf: {} }))
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.includes('/users/me')) return new Response(JSON.stringify({ id: 41 }), { status: 200 })
      if (url.includes('status=publish') && url.endsWith('&page=1')) return new Response(JSON.stringify(hundred), { status: 200 })
      if (url.includes('status=publish')) return new Response(JSON.stringify({ code: 'rest_post_invalid_page_number', message: 'The page number requested is larger than the number of pages available.' }), { status: 400 })
      return new Response('[]', { status: 200 })
    })
    expect(await api().listEventPosts()).toHaveLength(100)
  })
})

