import { useEffect, useState } from 'react'

// Pages live in the URL hash (#/events, #/events/new, #/events/<id>), so a
// refresh or a bookmark lands on the same page. Each dashboard section owns the
// first part of the path; add new sections in layout/sections.ts.

export type Route = { section: string; parts: string[] }

export function parseRoute(hash: string): Route {
  const [section = '', ...parts] = hash.replace(/^#\/?/, '').split('/').filter(Boolean)
  return { section, parts }
}

export function navigate(path: string) {
  window.location.hash = path.startsWith('/') ? path : `/${path}`
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash))
  useEffect(() => {
    const onChange = () => {
      setRoute(parseRoute(window.location.hash))
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}
