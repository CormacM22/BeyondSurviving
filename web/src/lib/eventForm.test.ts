import { describe, expect, it } from 'vitest'
import { copyOf, emptyForm, fromRow, toRow, validate, type EventFormValues } from './eventForm'

const inPerson: EventFormValues = {
  ...emptyForm(),
  title: '  Support Group – Mayo ',
  summary: 'Monthly peer support',
  description: 'A friendly monthly meetup.',
  websiteTitle: '',
  websiteText: 'Short website note.',
  websiteLocation: '',
  websitePostId: '',
  startLocal: '2026-10-10T11:00',
  endLocal: '2026-10-10T13:00',
  isOnline: false,
  publicArea: 'Mayo',
  venueName: 'Community Centre',
  venueAddress: '1 Main St, Castlebar',
  capacity: '12',
  category: 'support_group',
}

describe('validate', () => {
  it('accepts a complete in-person event', () => {
    expect(validate(inPerson)).toEqual({})
  })

  it('accepts an online event with no address', () => {
    expect(validate({ ...inPerson, isOnline: true, publicArea: '', venueName: '', venueAddress: '' })).toEqual({})
  })

  it('requires the basics', () => {
    const errors = validate(emptyForm())
    expect(Object.keys(errors).sort()).toEqual(
      ['capacity', 'description', 'endLocal', 'publicArea', 'startLocal', 'title', 'venueAddress', 'websiteText'].sort(),
    )
  })

  it('the website title is optional', () => {
    expect(validate({ ...inPerson, websiteTitle: '' }).websiteTitle).toBeUndefined()
  })

  it('treats blank-looking text as missing', () => {
    expect(validate({ ...inPerson, title: '   ' }).title).toBeDefined()
  })

  it('an in-person event needs the area and the full address', () => {
    const errors = validate({ ...inPerson, publicArea: '', venueAddress: ' ' })
    expect(errors.publicArea).toBeDefined()
    expect(errors.venueAddress).toBeDefined()
  })

  it('the end must be after the start', () => {
    expect(validate({ ...inPerson, endLocal: '2026-10-10T11:00' }).endLocal).toBeDefined()
    expect(validate({ ...inPerson, endLocal: '2026-10-10T10:00' }).endLocal).toBeDefined()
  })

  it('the summary is at most 140 characters', () => {
    expect(validate({ ...inPerson, summary: 'x'.repeat(140) }).summary).toBeUndefined()
    expect(validate({ ...inPerson, summary: 'x'.repeat(141) }).summary).toBeDefined()
  })

  it('capacity must be a whole number above zero', () => {
    for (const bad of ['0', '-3', '2.5', 'ten', '']) {
      expect(validate({ ...inPerson, capacity: bad }).capacity, bad).toBeDefined()
    }
  })
})

describe('toRow', () => {
  it('trims text and stores times as UTC', () => {
    const row = toRow(inPerson)
    expect(row.title).toBe('Support Group – Mayo')
    expect(row.starts_at).toBe('2026-10-10T10:00:00.000Z')
    expect(row.ends_at).toBe('2026-10-10T12:00:00.000Z')
    expect(row.capacity).toBe(12)
    expect(row.timezone).toBe('Europe/Dublin')
  })

  it('an online event never stores an address, even if one was typed before switching', () => {
    const row = toRow({ ...inPerson, isOnline: true })
    expect(row.is_online).toBe(true)
    expect(row.public_area).toBeNull()
    expect(row.venue_name).toBeNull()
    expect(row.venue_address).toBeNull()
  })

  it('stores the website title and text, with an empty title as nothing', () => {
    expect(toRow({ ...inPerson, websiteTitle: '  ' }).website_title).toBeNull()
    expect(toRow({ ...inPerson, websiteTitle: ' Support Group – Mayo ' }).website_title).toBe('Support Group – Mayo')
    expect(toRow(inPerson).website_text).toBe('Short website note.')
  })

  it('stores the website location, with an empty one as nothing', () => {
    expect(toRow(inPerson).website_location).toBeNull()
    expect(toRow({ ...inPerson, websiteLocation: ' Online (Weekly) ' }).website_location).toBe('Online (Weekly)')
  })

  it('stores the website post to reuse, or nothing for a new post', () => {
    expect(toRow(inPerson).website_post_id).toBeNull()
    expect(toRow({ ...inPerson, websitePostId: '5505' }).website_post_id).toBe('5505')
  })

  it('an empty summary is stored as nothing', () => {
    expect(toRow({ ...inPerson, summary: '  ' }).summary).toBeNull()
  })
})

describe('fromRow', () => {
  it('round-trips through the database shape', () => {
    const row = { ...toRow(inPerson), starts_at: '2026-10-10 10:00:00+00', ends_at: '2026-10-10 12:00:00+00' }
    expect(fromRow(row)).toEqual({ ...inPerson, title: 'Support Group – Mayo' })
  })
})

describe('copying an event', () => {
  const original = { ...toRow(inPerson), starts_at: '2026-10-10 10:00:00+00', ends_at: '2026-10-10 12:00:00+00' }

  it('keeps every detail of the original', () => {
    expect(copyOf(original)).toEqual({ ...inPerson, title: 'Support Group – Mayo' })
  })

  it('a copy reuses the same website post', () => {
    expect(copyOf({ ...original, website_post_id: '5505' }).websitePostId).toBe('5505')
  })

  it('refuses to save until the start time is changed', () => {
    const copy = copyOf(original)
    expect(validate(copy, { copiedFromStart: copy.startLocal }).startLocal).toMatch(/new date/)
    expect(validate({ ...copy, startLocal: '2026-11-14T11:00', endLocal: '2026-11-14T13:00' }, { copiedFromStart: copy.startLocal })).toEqual({})
  })

  it('the saved copy carries nothing from the original’s Eventbrite or website records', () => {
    const row = toRow(copyOf(original)) as Record<string, unknown>
    for (const key of ['id', 'status', 'created_by', 'event_publications', 'external_id', 'external_url'])
      expect(row).not.toHaveProperty(key)
  })
})
