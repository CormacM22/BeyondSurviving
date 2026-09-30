import { useState, type ReactNode } from 'react'
import type { Section } from './sections'

type Props = {
  sections: Section[]
  activeId: string | null
  email: string | undefined
  onSignOut: () => void
  children: ReactNode
}

export function AppShell({ sections, activeId, email, onSignOut, children }: Props) {
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <div className="shell">
      <aside className={`sidebar ${menuOpen ? 'is-open' : ''}`}>
        <div className="sidebar-top">
          <a href="#/" className="brand" aria-label="Beyond Surviving dashboard home">
            <img src="/logo.png" alt="Beyond Surviving" />
          </a>
          <button
            className="menu-toggle"
            aria-expanded={menuOpen}
            aria-controls="main-nav"
            onClick={() => setMenuOpen((o) => !o)}
          >
            {menuOpen ? 'Close' : 'Menu'}
          </button>
        </div>

        <div className="sidebar-body" id="main-nav">
          <nav aria-label="Dashboard sections">
            <ul className="nav">
              {sections.map((s) => (
                <li key={s.id}>
                  <a
                    href={`#/${s.id}`}
                    className="nav-link"
                    aria-current={s.id === activeId ? 'page' : undefined}
                    onClick={() => setMenuOpen(false)}
                  >
                    {s.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div className="account">
            <span className="account-email" title={email}>{email}</span>
            <button className="account-signout" onClick={onSignOut}>Sign out</button>
          </div>
        </div>
      </aside>

      <main className="main">{children}</main>
    </div>
  )
}

/** Page title in the site's style: a soft serif heading with the orange underline. */
export function PageHeader({ title, summary, back, actions }: {
  title: string
  summary?: string
  back?: ReactNode
  /** Buttons shown beside the title. */
  actions?: ReactNode
}) {
  return (
    <header className="page-header">
      {back}
      <div className="page-title-row">
        <h1 className="page-title"><span>{title}</span></h1>
        {actions}
      </div>
      {summary && <p className="page-summary">{summary}</p>}
    </header>
  )
}
