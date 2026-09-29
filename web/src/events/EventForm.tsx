import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import {
  CATEGORIES, SUMMARY_MAX, emptyForm, fromRow, toRow, validate,
  type EventFormValues, type EventRow, type FormErrors,
} from '../lib/eventForm'

const COVER_BUCKET = 'event-covers'
const COVER_MAX_BYTES = 10 * 1024 * 1024
const COVER_TYPES = ['image/jpeg', 'image/png']

type Props = { eventId: string | null; onDone: () => void }

export function EventForm({ eventId, onDone }: Props) {
  const [values, setValues] = useState<EventFormValues>(emptyForm)
  const [errors, setErrors] = useState<FormErrors>({})
  const [coverPath, setCoverPath] = useState<string | null>(null)
  const [coverPreview, setCoverPreview] = useState<string | null>(null)
  const [newCover, setNewCover] = useState<File | null>(null)
  const [coverError, setCoverError] = useState<string | null>(null)
  const [loading, setLoading] = useState(eventId !== null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    if (!eventId) return
    supabase.from('events').select('*').eq('id', eventId).single().then(async ({ data, error }) => {
      if (error || !data) {
        setSaveError('Couldn’t load this event. Please go back and try again.')
      } else {
        setValues(fromRow(data as EventRow))
        setCoverPath(data.cover_image_path)
        if (data.cover_image_path) {
          const { data: signed } = await supabase.storage
            .from(COVER_BUCKET).createSignedUrl(data.cover_image_path, 3600)
          setCoverPreview(signed?.signedUrl ?? null)
        }
      }
      setLoading(false)
    })
  }, [eventId])

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
    const found = validate(values)
    setErrors(found)
    if (Object.keys(found).length > 0) return

    setSaving(true)
    setSaveError(null)
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
    const { error } = eventId
      ? await supabase.from('events').update(row).eq('id', eventId)
      : await supabase.from('events').insert({ id, ...row })
    setSaving(false)
    if (error) return setSaveError('The event couldn’t be saved. Please check the details and try again.')
    onDone()
  }

  if (loading) return <p className="muted">Loading…</p>

  return (
    <section>
      <button type="button" className="link" onClick={onDone}>← Back to events</button>
      <h2>{eventId ? 'Edit event' : 'New event'}</h2>
      <p className="muted">Saved as a draft. Nothing is published to Eventbrite or the website yet.</p>

      <form onSubmit={onSubmit} noValidate>
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
          hint={`${values.summary.trim().length}/${SUMMARY_MAX}. Shown under the title on Eventbrite.`}
          error={errors.summary}
        >
          <input value={values.summary} onChange={(e) => set('summary', e.target.value)} />
        </Field>

        <Field label="Description" error={errors.description}>
          <textarea rows={8} value={values.description} onChange={(e) => set('description', e.target.value)} />
        </Field>

        <div className="two-col">
          <Field label="Starts" hint="Irish time" error={errors.startLocal}>
            <input type="datetime-local" value={values.startLocal} onChange={(e) => set('startLocal', e.target.value)} />
          </Field>
          <Field label="Ends" hint="Irish time" error={errors.endLocal}>
            <input type="datetime-local" value={values.endLocal} onChange={(e) => set('endLocal', e.target.value)} />
          </Field>
        </div>

        <label className="checkbox">
          <input type="checkbox" checked={values.isOnline} onChange={(e) => set('isOnline', e.target.checked)} />
          This is an online event
        </label>

        {!values.isOnline && (
          <fieldset>
            <Field label="Area shown publicly" hint="e.g. “Mayo” or “Dublin city”. Shown on Eventbrite and the website." error={errors.publicArea}>
              <input value={values.publicArea} onChange={(e) => set('publicArea', e.target.value)} />
            </Field>
            <Field label="Venue name (optional)" hint="For your records. Not published.">
              <input value={values.venueName} onChange={(e) => set('venueName', e.target.value)} />
            </Field>
            <Field label="Full address" hint="For your records. Not published." error={errors.venueAddress}>
              <textarea rows={2} value={values.venueAddress} onChange={(e) => set('venueAddress', e.target.value)} />
            </Field>
          </fieldset>
        )}

        <Field label="Number of places" error={errors.capacity}>
          <input inputMode="numeric" value={values.capacity} onChange={(e) => set('capacity', e.target.value)} />
        </Field>

        <Field label="Cover image (optional)" hint="JPG or PNG, up to 10 MB. Wide images work best on Eventbrite." error={coverError ?? undefined}>
          <input type="file" accept={COVER_TYPES.join(',')} onChange={(e) => chooseCover(e.target.files?.[0])} />
        </Field>
        {coverPreview && <img className="cover-preview" src={coverPreview} alt="Cover image preview" />}

        {saveError && <p className="error" role="alert">{saveError}</p>}
        <button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save draft'}</button>
      </form>
    </section>
  )
}

function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small className="muted">{hint}</small>}
      {error && <small className="error">{error}</small>}
    </label>
  )
}
