import { afterEach, describe, expect, it, vi } from 'vitest'
import { eventbriteApi } from './api.ts'

// Records the requests the real API client makes, answering each with `reply`.
function captureFetch(reply: unknown = {}) {
  const requests: { url: string; method: string; headers: Record<string, string>; body: unknown }[] = []
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    requests.push({
      url,
      method: init.method ?? 'GET',
      headers: Object.fromEntries(new Headers(init.headers).entries()),
      body: init.body,
    })
    return new Response(JSON.stringify(reply), { status: 200 })
  })
  return requests
}

afterEach(() => { vi.unstubAllGlobals() })

describe('eventbriteApi requests', () => {
  it('GET requests carry no JSON content type (Eventbrite then ignores the query string)', async () => {
    const requests = captureFetch({ status: 'draft' })
    await eventbriteApi('tok', 'org').getEventStatus('123')
    expect(requests[0].method).toBe('GET')
    expect(requests[0].headers['content-type']).toBeUndefined()
    expect(requests[0].headers.authorization).toBe('Bearer tok')
  })

  it('POST requests send JSON', async () => {
    const requests = captureFetch({ id: '1', url: 'u' })
    await eventbriteApi('tok', 'org').createEvent({ name: { html: 'x' } })
    expect(requests[0].headers['content-type']).toBe('application/json')
    expect(JSON.parse(requests[0].body as string)).toEqual({ event: { name: { html: 'x' } } })
  })

  it('asks for an image upload at the address Eventbrite actually serves (no redirect)', async () => {
    const requests = captureFetch({ upload_url: 'https://upload.test', upload_data: {}, file_parameter_name: 'file', upload_token: 't', id: 'img' })
    await eventbriteApi('tok', 'org').uploadLogo({ bytes: new Uint8Array([1]), contentType: 'image/png' })
    expect(requests[0].url).toBe('https://www.eventbriteapi.com/v3/media/upload/?type=image-event-logo')
    expect(requests[0].headers['content-type']).toBeUndefined()
  })

  it('a create reply without an id counts as unclear, not as a refusal', async () => {
    captureFetch({})
    await expect(eventbriteApi('tok', 'org').createEvent({})).rejects.toThrow(/without an event id/)
  })
})
