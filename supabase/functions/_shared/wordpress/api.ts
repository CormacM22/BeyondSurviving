// The real WordPress REST API for the site's Events section. Each call here was
// confirmed on the live site with a test draft first: see knowledge/build/wordpress-api.md
// (kept outside the repo).

import { WordPressError } from './types.ts'
import type { PostSummary, WordPressApi } from './types.ts'

const TIMEOUT_MS = 20_000

// WordPress sends titles with HTML entities ("&#8211;"); show them as plain text.
const decodeEntities = (s: string) =>
  s.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replaceAll('&quot;', '"').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&')

type RawPost = { id: number; title: { rendered: string }; status: string; acf?: { event_date?: string | null; event_location?: string | null } }

export function wordpressApi(siteUrl: string, user: string, appPassword: string): WordPressApi {
  const base = `${siteUrl.replace(/\/$/, '')}/wp-json/wp/v2`
  const auth = 'Basic ' + btoa(`${user}:${appPassword}`)

  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(base + path, {
      method,
      headers: body === undefined
        ? { Authorization: auth }
        : { Authorization: auth, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const text = await res.text()
    if (!res.ok) {
      let message = text.slice(0, 300)
      let code: string | undefined
      try {
        const j = JSON.parse(text)
        message = j.message ?? message
        code = j.code
      } catch { /* keep raw text */ }
      throw new WordPressError(res.status, message, code)
    }
    return (text ? JSON.parse(text) : {}) as T
  }

  return {
    async createPost(post) {
      const p = await call<{ id?: unknown; link?: unknown }>('POST', '/events', post)
      // A plain Error (not WordPressError) counts as "unclear": the post may exist.
      if (typeof p.id !== 'number' && typeof p.id !== 'string') throw new Error('WordPress replied without a post id')
      return { id: String(p.id), link: typeof p.link === 'string' ? p.link : '' }
    },

    async updatePost(id, fields) {
      await call('POST', `/events/${encodeURIComponent(id)}`, fields)
    },

    async getPost(id) {
      try {
        const p = await call<{ status: string; link: string }>('GET', `/events/${encodeURIComponent(id)}?context=edit&_fields=status,link`)
        return { status: p.status, link: p.link }
      } catch (e) {
        if (e instanceof WordPressError && (e.status === 404 || e.status === 410)) return null
        throw e
      }
    },

    async listEventPosts() {
      const fields = '_fields=id,title,status,acf&per_page=100'
      // Every page, not just the first 100.
      const all = async (query: string) => {
        const out: RawPost[] = []
        for (let page = 1; page <= 20; page++) {
          let batch: RawPost[]
          try {
            batch = await call<RawPost[]>('GET', `/events?${query}&${fields}&page=${page}`)
          } catch (e) {
            // Asking for the page after the last one: there are no more posts.
            if (page > 1 && e instanceof WordPressError && e.code === 'rest_post_invalid_page_number') break
            throw e
          }
          out.push(...batch)
          if (batch.length < 100) break
        }
        return out
      }
      const me = await call<{ id: number }>('GET', '/users/me?_fields=id')
      const published = await all('status=publish')
      const hidden = await all(`status=draft&author=${me.id}`)
      // Her Events posts don't report an author (the post type doesn't support it), so
      // which published posts the dashboard owns comes from WordPress's author filter.
      const owned = new Set([...(await all(`status=publish&author=${me.id}`)), ...hidden].map((p) => p.id))
      return [...published, ...hidden].map((p): PostSummary => ({
        id: String(p.id),
        title: decodeEntities(p.title.rendered),
        status: p.status,
        eventDate: p.acf?.event_date || null,
        location: p.acf?.event_location ?? '',
        editable: owned.has(p.id),
      }))
    },

    async getPostStatus(id) {
      try {
        const p = await call<{ status: string }>('GET', `/events/${encodeURIComponent(id)}?context=edit&_fields=status`)
        return p.status
      } catch (e) {
        if (e instanceof WordPressError && (e.status === 404 || e.status === 410)) return 'gone'
        throw e
      }
    },
  }
}
