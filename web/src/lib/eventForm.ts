// The event form's values, its rules, and how it maps to the events table.
// These rules mirror the database's own checks, so mistakes are caught in the
// form with a friendly message rather than as a database error.

import { dublinLocalToUtc, utcToDublinLocal } from './dublinTime'

export const CATEGORIES = [
  { value: 'support_group', label: 'Support group' },
  { value: 'community_event', label: 'Community event' },
  { value: 'fundraiser', label: 'Fundraiser' },
] as const

export type Category = (typeof CATEGORIES)[number]['value']

export type EventFormValues = {
  title: string
  summary: string
  description: string
  startLocal: string
  endLocal: string
  isOnline: boolean
  publicArea: string
  venueName: string
  venueAddress: string
  capacity: string
  category: Category
}

export type EventRow = {
  title: string
  summary: string | null
  description: string
  starts_at: string
  ends_at: string
  timezone: string
  is_online: boolean
  public_area: string | null
  venue_name: string | null
  venue_address: string | null
  capacity: number
  category: Category
}

export type FormErrors = Partial<Record<keyof EventFormValues, string>>

export const SUMMARY_MAX = 140

export function emptyForm(): EventFormValues {
  return {
    title: '',
    summary: '',
    description: '',
    startLocal: '',
    endLocal: '',
    isOnline: false,
    publicArea: '',
    venueName: '',
    venueAddress: '',
    capacity: '',
    category: 'support_group',
  }
}

const blank = (s: string) => s.trim() === ''

export function validate(v: EventFormValues): FormErrors {
  const e: FormErrors = {}
  if (blank(v.title)) e.title = 'Please add a title.'
  if (blank(v.description)) e.description = 'Please add a description.'
  if (v.summary.trim().length > SUMMARY_MAX) e.summary = `Keep the summary to ${SUMMARY_MAX} characters or fewer.`
  if (!v.startLocal) e.startLocal = 'Please choose when it starts.'
  if (!v.endLocal) e.endLocal = 'Please choose when it ends.'
  else if (v.startLocal && dublinLocalToUtc(v.endLocal) <= dublinLocalToUtc(v.startLocal)) {
    e.endLocal = 'The end needs to be after the start.'
  }
  if (!v.isOnline) {
    if (blank(v.publicArea)) e.publicArea = 'Please add the area to show publicly, e.g. “Mayo”.'
    if (blank(v.venueAddress)) e.venueAddress = 'Please add the full address.'
  }
  if (!/^\d+$/.test(v.capacity.trim()) || Number(v.capacity) < 1) {
    e.capacity = 'Please enter how many places there are (a whole number).'
  }
  return e
}

const orNull = (s: string) => (blank(s) ? null : s.trim())

export function toRow(v: EventFormValues): EventRow {
  return {
    title: v.title.trim(),
    summary: orNull(v.summary),
    description: v.description.trim(),
    starts_at: dublinLocalToUtc(v.startLocal),
    ends_at: dublinLocalToUtc(v.endLocal),
    timezone: 'Europe/Dublin',
    is_online: v.isOnline,
    public_area: v.isOnline ? null : orNull(v.publicArea),
    venue_name: v.isOnline ? null : orNull(v.venueName),
    venue_address: v.isOnline ? null : orNull(v.venueAddress),
    capacity: Number(v.capacity.trim()),
    category: v.category,
  }
}

export function fromRow(r: EventRow): EventFormValues {
  return {
    title: r.title,
    summary: r.summary ?? '',
    description: r.description,
    startLocal: utcToDublinLocal(r.starts_at),
    endLocal: utcToDublinLocal(r.ends_at),
    isOnline: r.is_online,
    publicArea: r.public_area ?? '',
    venueName: r.venue_name ?? '',
    venueAddress: r.venue_address ?? '',
    capacity: String(r.capacity),
    category: r.category,
  }
}
