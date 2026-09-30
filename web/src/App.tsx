import { useEffect, useState, type FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import { navigate, useRoute } from './lib/route'
import { AppShell, PageHeader } from './layout/AppShell'
import { SECTIONS, type Section } from './layout/sections'

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  if (loading) return null
  return session ? <SignedIn session={session} /> : <SignIn />
}

function SignIn() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError('That email and password don’t match. Check them and try again.')
    setBusy(false)
  }

  return (
    <div className="signin">
      <img className="signin-logo" src="/logo.png" alt="Beyond Surviving" />
      <main className="signin-card">
        <h1 className="signin-title">Dashboard</h1>
        <form onSubmit={onSubmit}>
          <label className="field">
            <span>Email</span>
            <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="field">
            <span>Password</span>
            <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          {error && <p className="error" role="alert">{error}</p>}
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        </form>
      </main>
    </div>
  )
}

function SignedIn({ session }: { session: Session }) {
  const route = useRoute()
  const [allowed, setAllowed] = useState<Section[] | null>(null)

  // Only show the sections this user has permission for.
  useEffect(() => {
    Promise.all(
      SECTIONS.map(async (s) => {
        const { data, error } = await supabase.rpc('has_permission', { permission: s.permission })
        return !error && data === true ? s : null
      }),
    ).then((found) => setAllowed(found.filter((s): s is Section => s !== null)))
  }, [])

  const active = allowed?.find((s) => s.id === route.section) ?? null

  // Land on the first section the user can use.
  useEffect(() => {
    if (allowed && allowed.length > 0 && !active) navigate(`/${allowed[0].id}`)
  }, [allowed, active])

  return (
    <AppShell
      sections={allowed ?? []}
      activeId={active?.id ?? null}
      email={session.user.email}
      onSignOut={() => supabase.auth.signOut()}
    >
      {allowed && allowed.length === 0 && (
        <PageHeader
          title="No access yet"
          summary="Your account isn’t set up for any part of the dashboard yet. Ask Ciara to give you access."
        />
      )}
      {active && <active.Page parts={route.parts} />}
    </AppShell>
  )
}
