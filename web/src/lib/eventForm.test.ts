import { describe, expect, it } from 'vitest'
import { emptyForm, fromRow, toRow, validate, type EventFormValues } from './eventForm'

const inPerson: EventFormValues = {
  ...emptyForm(),
  title: '  Support Group – Mayo ',
  summary: 'Monthly peer support',
  description: 'A friendly monthly meetup.',
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
      ['capacity', 'description', 'endLocal', 'publicArea', 'startLocal', 'title', 'venueAddress'].sort(),
    )
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
