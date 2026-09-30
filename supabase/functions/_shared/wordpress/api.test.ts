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
    const created = await api().createPost({ title: 'T', content: 'C', status: 'draft' })
    expect(created).toEqual({ id: '42', link: 'https://site.test/?p=42' })
    expect(requests[0].method).toBe('POST')
    expect(requests[0].url).toBe('https://site.test/wp-json/wp/v2/events')
    expect(requests[0].headers['content-type']).toBe('application/json')
    expect(JSON.parse(requests[0].body as string)).toEqual({ title: 'T', content: 'C', status: 'draft' })
  })

  it('a create reply without an id counts as unclear, not a refusal', async () => {
    stubFetch(201, {})
    const err = await api().createPost({ title: 'T', content: 'C', status: 'draft' }).catch((e) => e)
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
