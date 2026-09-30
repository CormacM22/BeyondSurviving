import { describe, expect, it } from 'vitest'
import { descriptionHtml, eventPayload, toEventbriteUtc } from './payload.ts'
import type { EventRecord } from './types.ts'
import { inPersonEvent } from './fixtures.ts'


describe('toEventbriteUtc', () => {
  it('uses the format Eventbrite accepts (no milliseconds)', () => {
    expect(toEventbriteUtc('2026-10-10T10:00:00+00:00')).toBe('2026-10-10T10:00:00Z')
    expect(toEventbriteUtc('2026-10-10T10:00:00.000Z')).toBe('2026-10-10T10:00:00Z')
    expect(toEventbriteUtc('2026-10-10 11:00:00+01')).toBe('2026-10-10T10:00:00Z')
  })
})

describe('descriptionHtml', () => {
  it('turns blank-line-separated text into paragraphs and escapes HTML', () => {
    expect(descriptionHtml('All welcome.\n\nTea & coffee <provided>.')).toBe(
      '<p>All welcome.</p><p>Tea &amp; coffee &lt;provided&gt;.</p>',
    )
  })

  it('keeps single line breaks', () => {
    expect(descriptionHtml('Line one\nLine two')).toBe('<p>Line one<br>Line two</p>')
  })
})

describe('eventPayload', () => {
  it('builds the event in Irish time, free, in euro', () => {
    const p = eventPayload(inPersonEvent, { venueId: 'v-1', listed: true })
    expect(p).toEqual({
      name: { html: 'Support Group – Mayo' },
      summary: 'Monthly peer support',
      start: { timezone: 'Europe/Dublin', utc: '2026-10-10T10:00:00Z' },
      end: { timezone: 'Europe/Dublin', utc: '2026-10-10T12:00:00Z' },
      currency: 'EUR',
      online_event: false,
      listed: true,
      venue_id: 'v-1',
      category_id: '107',
      capacity: 12,
    })
  })

  it('never includes the venue name or street address', () => {
    const json = JSON.stringify(eventPayload(inPersonEvent, { venueId: 'v-1', listed: true }))
    expect(json).not.toContain('Main St')
    expect(json).not.toContain('Community Centre')
  })

  it('an online event has no venue', () => {
    const p = eventPayload({ ...inPersonEvent, is_online: true, public_area: null }, { venueId: null, listed: true })
    expect(p.online_event).toBe(true)
    expect(p.venue_id).toBeNull()
  })

  it('maps each category', () => {
    const id = (category: EventRecord['category']) =>
      eventPayload({ ...inPersonEvent, category }, { venueId: 'v', listed: true }).category_id
    expect(id('support_group')).toBe('107')
    expect(id('community_event')).toBe('113')
    expect(id('fundraiser')).toBe('111')
  })

  it('escapes the title and sends an empty summary as blank', () => {
    const p = eventPayload({ ...inPersonEvent, title: 'Tea & <Talk>', summary: null }, { venueId: 'v', listed: false })
    expect(p.name.html).toBe('Tea &amp; &lt;Talk&gt;')
    expect(p.summary).toBe('')
    expect(p.listed).toBe(false)
  })
})
