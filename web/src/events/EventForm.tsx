import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { PublishPanel, type EventbriteState } from './PublishPanel'
import { WebsitePanel, type WebsiteState } from './WebsitePanel'
import { PageHeader } from '../layout/AppShell'
import { PostPicker } from './PostPicker'
import {
  CATEGORIES, SUMMARY_MAX, copyOf, emptyForm, fromRow, toRow, validate,
  type EventFormValues, type EventRow, type FormErrors,
} from '../lib/eventForm'

const COVER_BUCKET = 'event-covers'
const COVER_MAX_BYTES = 10 * 1024 * 1024
const COVER_TYPES = ['image/jpeg', 'image/png']

type Props = {
  eventId: string | null
  /** Start a new event as a copy of this one. */
  copyFrom?: string
  onDone: () => void
  onCreated?: (id: string) => void
  onCopy?: (id: string) => void
}

type EventStatus = 'draft' | 'published' | 'cancelled'

type Action = 'sync' | 'publish' | 'cancel' | 'website' | 'clear_check'
type Target = 'eventbrite' | 'wordpress'

type Reply = { message: string | null; websiteMessage: string | null }

// Calls the server-side publishing function. Returns its plain-English messages on
// failure: one for the step asked for, and one for the website step that follows it.
async function callEventbrite(action: Action, eventId: string, target: Target = 'eventbrite'): Promise<Reply> {
  const { data, error } = await supabase.functions.invoke('eventbrite', { body: { action, eventId, target } })
  let body = data
  if (error instanceof FunctionsHttpError) body = await error.context.json().catch(() => null)
  const websiteMessage = body?.website && !body.website.ok ? body.website.message ?? null : null
  if (!error) return { message: null, websiteMessage }
  return {
    message: body?.message ?? 'Couldn’t reach the server. Please check your connection and try again.',
    websiteMessage,
  }
}

export function EventForm({ eventId: initialId, copyFrom, onDone, onCreated, onCopy }: Props) {
  const [eventId, setEventId] = useState(initialId)
  const [eventStatus, setEventStatus] = useState<EventStatus>('draft')
  const [eventbrite, setEventbrite] = useState<EventbriteState | null>(null)
  const [website, setWebsite] = useState<WebsiteState | null>(null)
  const [sending, setSending] = useState(false)
  const [savedNote, setSavedNote] = useState<string | null>(null)
  const [values, setValues] = useState<EventFormValues>(emptyForm)
  const [errors, setErrors] = useState<FormErrors>({})
  const [coverPath, setCoverPath] = useState<string | null>(null)
  const [coverPreview, setCoverPreview] = useState<string | null>(null)
  const [newCover, setNewCover] = useState<File | null>(null)
  const [coverError, setCoverError] = useState<string | null>(null)
  const [loading, setLoading] = useState(initialId !== null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  // When this is a copy: the original's title and start, until the copy is first saved.
  const [copiedFrom, setCopiedFrom] = useState<{ title: string; startLocal: string } | null>(null)
  const [copyLoading, setCopyLoading] = useState(!!copyFrom)
  // Website post: create a new one, or update one of the existing posts.
  const [reusePost, setReusePost] = useState(false)

  const loadEventbrite = useCallback(async (id: string) => {
    const [{ data: pubs }, { data: ev }] = await Promise.all([
      supabase.from('event_publications')
        .select('target, status, external_id, external_url, last_error, needs_check, meta')
        .eq('event_id', id),
      supabase.from('events').select('status').eq('id', id).single(),
    ])
    if (ev) setEventStatus(ev.status)
    const stateOf = (target: Target) => {
      const pub = pubs?.find((p) => p.target === target)
      return {
        status: pub?.status ?? 'not_started',
        url: pub?.external_url ?? null,
        lastError: pub?.last_error ?? null,
        needsCheck: pub?.needs_check ?? false,
        hasPost: !!pub?.external_id,
        note: (pub?.meta as { note?: string | null } | undefined)?.note ?? null,
        handedOver: !!(pub?.meta as { handedOver?: boolean } | undefined)?.handedOver,
      }
    }
    setEventbrite(stateOf('eventbrite'))
    setWebsite(stateOf('wordpress'))
  }, [])

  async function runEventbrite(action: Action, id: string, target: Target = 'eventbrite') {
    setSending(true)
    const { message, websiteMessage } = await callEventbrite(action, id, target)
    await loadEventbrite(id)
    // Show each failure on the panel it belongs to.
    const forWebsite = action === 'website' || target === 'wordpress'
    if (message && forWebsite) setWebsite((s) => (s ? { ...s, lastError: message } : s))
    if (message && !forWebsite) setEventbrite((s) => (s ? { ...s, lastError: message } : s))
    if (websiteMessage && !forWebsite) setWebsite((s) => (s ? { ...s, lastError: s.lastError ?? websiteMessage } : s))
    setSending(false)
    return message === null
  }

  // A copy starts with all the original's details, including its cover image.
  useEffect(() => {
    if (!copyFrom) return
    supabase.from('events').select('*').eq('id', copyFrom).single().then(async ({ data, error }) => {
      if (error || !data) {
        setSaveError('The event to copy couldn’t be loaded. Go back and try again.')
      } else {
        const copy = copyOf(data as EventRow)
        setValues(copy)
        setReusePost(!!copy.websitePostId)
        setCopiedFrom({ title: copy.title, startLocal: copy.startLocal })
        setCoverPath(data.cover_image_path)
        if (data.cover_image_path) {
          const { data: signed } = await supabase.storage
            .from(COVER_BUCKET).createSignedUrl(data.cover_image_path, 3600)
          setCoverPreview(signed?.signedUrl ?? null)
        }
      }
      setCopyLoading(false)
    })
  }, [copyFrom])

  useEffect(() => {
    if (!initialId) return
    supabase.from('events').select('*').eq('id', initialId).single().then(async ({ data, error }) => {
      await loadEventbrite(initialId)
      if (error || !data) {
        setSaveError('Couldn’t load this event. Please go back and try again.')
      } else {
        setValues(fromRow(data as EventRow))
        setReusePost(!!(data as EventRow).website_post_id)
        setCoverPath(data.cover_image_path)
        if (data.cover_image_path) {
          const { data: signed } = await supabase.storage
            .from(COVER_BUCKET).createSignedUrl(data.cover_image_path, 3600)
          setCoverPreview(signed?.signedUrl ?? null)
        }
      }
      setLoading(false)
    })
  }, [initialId, loadEventbrite])

  function set<K extends keyof EventFormValues>(key: K, value: EventFormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }))
    setErrors((e) => ({ ...e, [key]: undefined }))
  }

  function chooseCover(file: File | undefined) {
    setCoverError(null)
    if (!file) return
    if (!COVER_TYPES.includes(file.type)) return setCoverError('Please choose a JPG or PNG image.')
    if (file.size > COVER_MAX_BYTES) return setCoverError('That image is over 10 MB. Please choose a smaller one.')
    setNewCover(file)
    setCoverPreview(URL.createObjectURL(file))
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const found = validate(values, { copiedFromStart: copiedFrom?.startLocal })
    if (reusePost && !values.websitePostId) found.websitePostId = 'Choose the post to update, or choose “Create a new post”.'
    setErrors(found)
    if (Object.keys(found).length > 0) return

    setSaving(true)
    setSaveError(null)
    setSavedNote(null)
    const id = eventId ?? crypto.randomUUID()

    let path = coverPath
    if (newCover) {
      const ext = newCover.type === 'image/png' ? 'png' : 'jpg'
      path = `${id}/cover-${Date.now()}.${ext}`
      const { error } = await supabase.storage.from(COVER_BUCKET).upload(path, newCover, { contentType: newCover.type })
      if (error) {
        setSaving(false)
        return setSaveError('The image couldn’t be uploaded. Please try again.')
      }
    }

    const row = { ...toRow(values), cover_image_path: path }
    const { data: saved, error } = eventId
      ? await supabase.from('events').update(row).eq('id', eventId).select('id')
      : await supabase.from('events').insert({ id, ...row }).select('id')
    setSaving(false)
    if (error) return setSaveError('The event couldn’t be saved. Please check the details and try again.')
    if (!saved?.length) {
      // The database refuses edits to a cancelled event (e.g. cancelled in another tab).
      await loadEventbrite(id)
      return setSaveError('This event has been cancelled, so it can’t be edited. Nothing was saved.')
    }

    if (!eventId) onCreated?.(id)
    setCopiedFrom(null)
    setEventId(id)
    setCoverPath(path)
    setNewCover(null)
    const sent = await runEventbrite('sync', id)
    setSavedNote(sent
      ? (isLive ? 'Saved, and the live Eventbrite event is updated.' : 'Saved, and the Eventbrite draft is up to date.')
      : 'Saved in the dashboard, but Eventbrite wasn’t updated. See below.')
  }

  const isCancelled = eventStatus === 'cancelled' || eventbrite?.status === 'cancelled'
  const isLive = !isCancelled && (eventStatus === 'published' || eventbrite?.status === 'live')

  if (loading || copyLoading) return <p className="muted loading">Loading…</p>

  const stepState = (st: EventbriteState | null) =>
    !st ? 'todo'
      : st.needsCheck || st.lastError ? 'attention'
      : st.status === 'not_started' ? 'todo'
      : st.status

  return (
    <div className="event-page">
      <PageHeader
        title={eventId ? values.title || 'Untitled event' : copiedFrom ? 'Copy of event' : 'New event'}
        summary={
          copiedFrom
            ? `Everything is copied from “${copiedFrom.title}”. Change the date and time, then save. It gets its own Eventbrite event and link.`
            : isCancelled
            ? 'This event is cancelled, so it can’t be edited or published.'
            : isLive
            ? 'This event is live. Saving updates Eventbrite and the website straight away.'
            : 'Saving updates a private Eventbrite draft. Nothing is public until you press Publish.'
        }
        back={<a href="#/events" className="back-link" onClick={(e) => { e.preventDefault(); onDone() }}>← All events</a>}
        actions={eventId && onCopy ? (
          <button type="button" className="btn btn-secondary" onClick={() => onCopy(eventId)}>Copy to a new event</button>
        ) : undefined}
      />

      <div className="event-layout">
        <form className="event-form" onSubmit={onSubmit} noValidate>
          <fieldset className="plain" disabled={isCancelled}>
            <section className="form-section" aria-labelledby="sec-event">
              <h2 id="sec-event" className="section-title">Eventbrite</h2>
              <p className="section-note">The full details people read before they register.</p>
              <Field label="Title" error={errors.title}>
                <input value={values.title} onChange={(e) => set('title', e.target.value)} />
              </Field>
              <Field label="Category">
                <select value={values.category} onChange={(e) => set('category', e.target.value as EventFormValues['category'])}>
                  {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </Field>
              <Field
                label="Short summary (optional)"
                hint={`${values.summary.trim().length} of ${SUMMARY_MAX} characters. Shown under the title on Eventbrite.`}
                error={errors.summary}
              >
                <input value={values.summary} onChange={(e) => set('summary', e.target.value)} />
              </Field>
              <Field label="Description" hint="Start a line with - for a bullet point. Put **two stars** around words for bold. Leave a blank line between paragraphs." error={errors.description}>
                <textarea rows={12} value={values.description} onChange={(e) => set('description', e.target.value)} />
              </Field>
            </section>

            <section className="form-section" aria-labelledby="sec-website">
              <h2 id="sec-website" className="section-title">Website post</h2>
              <p className="section-note">
                A short version for the Events page. The date and time come from “When” below, and the post ends with “Find out more and register here”, linking to this event on Eventbrite.
              </p>
              <Field label="Title on the website (optional)" hint="Leave blank to use the Eventbrite title." error={errors.websiteTitle}>
                <input value={values.websiteTitle} placeholder={values.title} onChange={(e) => set('websiteTitle', e.target.value)} />
              </Field>
              <fieldset className="choice" disabled={!!website?.hasPost}>
                <legend>Which post?</legend>
                <label className="checkbox">
                  <input type="radio" name="post-choice" checked={!reusePost}
                    onChange={() => { setReusePost(false); set('websitePostId', '') }} />
                  Create a new post
                </label>
                <label className="checkbox">
                  <input type="radio" name="post-choice" checked={reusePost} onChange={() => setReusePost(true)} />
                  Update one of the existing posts
                </label>
                {website?.hasPost && <small className="hint">This event’s website post is already set.</small>}
              </fieldset>
              {reusePost && (
                <PostPicker
                  value={values.websitePostId}
                  disabled={!!website?.hasPost}
                  error={errors.websitePostId}
                  onChange={(id) => set('websitePostId', id)}
                />
              )}
              <Field
                label="Location on the event card (optional)"
                hint="Shown under the time on “What’s coming up?”. Add details like “(Weekly)” or “City Centre”. Leave blank to use the area."
              >
                <input
                  value={values.websiteLocation}
                  placeholder={values.isOnline ? 'Online' : values.publicArea || 'For example: Castlebar, Co. Mayo'}
                  onChange={(e) => set('websiteLocation', e.target.value)}
                />
              </Field>
              <Field label="Short text" hint="Start a line with - for a bullet point. Put **two stars** around words for bold. Leave a blank line between paragraphs." error={errors.websiteText}>
                <textarea rows={6} value={values.websiteText} onChange={(e) => set('websiteText', e.target.value)} />
              </Field>
            </section>

            <section className="form-section" aria-labelledby="sec-when">
              <h2 id="sec-when" className="section-title">When</h2>
              <div className="two-col">
                <Field label="Starts" hint="Irish time" error={errors.startLocal}>
                  <input type="datetime-local" value={values.startLocal} onChange={(e) => set('startLocal', e.target.value)} />
                </Field>
                <Field label="Ends" hint="Irish time" error={errors.endLocal}>
                  <input type="datetime-local" value={values.endLocal} onChange={(e) => set('endLocal', e.target.value)} />
                </Field>
              </div>
            </section>

            <section className="form-section" aria-labelledby="sec-where">
              <h2 id="sec-where" className="section-title">Where</h2>
              <label className="checkbox">
                <input type="checkbox" checked={values.isOnline} onChange={(e) => set('isOnline', e.target.checked)} />
                This is an online event
              </label>
              {!values.isOnline && (
                <>
                  <Field label="Area shown publicly" hint="For example “Mayo” or “Dublin city”. Shown on Eventbrite and the website." error={errors.publicArea}>
                    <input value={values.publicArea} onChange={(e) => set('publicArea', e.target.value)} />
                  </Field>
                  <div className="records-only">
                    <p className="records-label">For your records. Not published.</p>
                    <Field label="Venue name (optional)">
                      <input value={values.venueName} onChange={(e) => set('venueName', e.target.value)} />
                    </Field>
                    <Field label="Full address" error={errors.venueAddress}>
                      <textarea rows={2} value={values.venueAddress} onChange={(e) => set('venueAddress', e.target.value)} />
                    </Field>
                  </div>
                </>
              )}
            </section>

            <section className="form-section" aria-labelledby="sec-places">
              <h2 id="sec-places" className="section-title">Places and image</h2>
              <Field label="Number of places" error={errors.capacity}>
                <input className="input-short" inputMode="numeric" value={values.capacity} onChange={(e) => set('capacity', e.target.value)} />
              </Field>
              <Field label="Cover image (optional)" hint="JPG or PNG, up to 10 MB. Wide images work best on Eventbrite." error={coverError ?? undefined}>
                <input type="file" accept={COVER_TYPES.join(',')} onChange={(e) => chooseCover(e.target.files?.[0])} />
              </Field>
              {coverPreview && <img className="cover-preview" src={coverPreview} alt="Cover image preview" />}
            </section>

            <div className="save-bar">
              {saveError && <p className="error" role="alert">{saveError}</p>}
              {savedNote && <p className="saved-note" role="status">{savedNote}</p>}
              <button type="submit" className="btn btn-primary" disabled={saving || sending}>
                {saving || sending ? 'Saving…' : isLive ? 'Save and update live event' : 'Save draft'}
              </button>
            </div>
          </fieldset>
        </form>

        <aside className="path-column" aria-label="Where this event is published">
          <h2 className="section-title">Publishing</h2>
          <ol className="path">
            <li className="path-step" data-state={eventId ? 'done' : 'todo'}>
              <div className="step-card">
                <div className="row">
                  <strong>Dashboard</strong>
                  <span className="badge">{eventId ? 'Saved' : 'Not saved yet'}</span>
                </div>
                {!eventId && <p className="muted">Save the event to create a private draft on Eventbrite.</p>}
              </div>
            </li>
            <li className="path-step" data-state={eventId ? stepState(eventbrite) : 'todo'}>
              {eventId ? (
                <PublishPanel
                  state={eventbrite}
                  busy={sending}
                  onRetry={() => runEventbrite('sync', eventId)}
                  onPublish={() => runEventbrite('publish', eventId)}
                  onCancel={() => runEventbrite('cancel', eventId)}
                  hidesWebsitePost={!!website?.hasPost && website.status !== 'cancelled'}
                  onClearCheck={async () => { if (await runEventbrite('clear_check', eventId)) await runEventbrite('sync', eventId) }}
                />
              ) : (
                <div className="step-card"><strong>Eventbrite</strong></div>
              )}
            </li>
            <li className="path-step" data-state={eventId ? stepState(website) : 'todo'}>
              {eventId ? (
                <WebsitePanel
                  state={website}
                  busy={sending}
                  outOfStep={!!website && !website.handedOver && (
                    isCancelled
                      ? website.status !== 'cancelled' && (website.status !== 'not_started' || website.hasPost)
                      : eventbrite?.status === 'live' && website.status === 'not_started'
                  )}
                  onRetry={() => runEventbrite('website', eventId)}
                  onClearCheck={async () => { if (await runEventbrite('clear_check', eventId, 'wordpress')) await runEventbrite('website', eventId) }}
                />
              ) : (
                <div className="step-card"><strong>Website</strong></div>
              )}
            </li>
          </ol>
        </aside>
      </div>
    </div>
  )
}

function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small className="hint">{hint}</small>}
      {error && <small className="error">{error}</small>}
    </label>
  )
}
