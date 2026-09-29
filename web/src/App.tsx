import { useEffect, useState, type FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import { EventsPage } from './events/EventsPage'

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
    if (error) setError('That email and password didn’t match. Please try again.')
    setBusy(false)
  }

  return (
    <main className="card">
      <h1>Beyond Surviving</h1>
      <p className="muted">Sign in to manage events.</p>
      <form onSubmit={onSubmit}>
        <label>
          Email
          <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Password
          <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <button type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </main>
  )
}

function SignedIn({ session }: { session: Session }) {
  const [canManageEvents, setCanManageEvents] = useState<boolean | null>(null)

  useEffect(() => {
    supabase.rpc('has_permission', { permission: 'events.manage' }).then(({ data, error }) => {
      setCanManageEvents(!error && data === true)
    })
  }, [])

  return (
    <>
      <header className="topbar">
        <strong>Beyond Surviving</strong>
        <span className="muted">{session.user.email}</span>
        <button className="secondary" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </header>
      <main className="page">
        {canManageEvents === false && (
          <p className="error">Your account doesn’t have access to events yet.</p>
        )}
        {canManageEvents && <EventsPage />}
      </main>
    </>
  )
}
