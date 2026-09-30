// The real WordPress REST API for the site's Events section. Each call here was
// confirmed on the live site with a test draft first: see knowledge/build/wordpress-api.md
// (kept outside the repo).

import { WordPressError } from './types.ts'
import type { WordPressApi } from './types.ts'

const TIMEOUT_MS = 20_000

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
      await call('POST', `/events/${id}`, fields)
    },

    async getPostStatus(id) {
      try {
        const p = await call<{ status: string }>('GET', `/events/${id}?context=edit&_fields=status`)
        return p.status
      } catch (e) {
        if (e instanceof WordPressError && (e.status === 404 || e.status === 410)) return 'gone'
        throw e
      }
    },
  }
}
