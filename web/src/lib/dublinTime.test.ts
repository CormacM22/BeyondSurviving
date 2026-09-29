import { describe, expect, it } from 'vitest'
import { dublinLocalToUtc, utcToDublinLocal } from './dublinTime'

// Irish clocks in 2026: forward 29 March at 01:00 UTC, back 25 October at 01:00 UTC.

describe('dublinLocalToUtc', () => {
  it('summer time is one hour ahead of UTC', () => {
    expect(dublinLocalToUtc('2026-10-10T11:00')).toBe('2026-10-10T10:00:00.000Z')
  })

  it('winter time is the same as UTC', () => {
    expect(dublinLocalToUtc('2026-12-05T11:00')).toBe('2026-12-05T11:00:00.000Z')
  })

  it('handles the days either side of the clocks going back', () => {
    expect(dublinLocalToUtc('2026-10-24T12:00')).toBe('2026-10-24T11:00:00.000Z')
    expect(dublinLocalToUtc('2026-10-25T12:00')).toBe('2026-10-25T12:00:00.000Z')
  })

  it('handles the days either side of the clocks going forward', () => {
    expect(dublinLocalToUtc('2026-03-28T12:00')).toBe('2026-03-28T12:00:00.000Z')
    expect(dublinLocalToUtc('2026-03-29T12:00')).toBe('2026-03-29T11:00:00.000Z')
  })

  it('a time skipped when the clocks go forward moves forward an hour', () => {
    // 01:30 on 29 March doesn't exist in Dublin; it becomes 02:30 Irish time.
    expect(dublinLocalToUtc('2026-03-29T01:30')).toBe('2026-03-29T01:30:00.000Z')
  })

  it('a time that happens twice when the clocks go back means the first one', () => {
    // 01:30 on 25 October happens in summer time, then again in winter time.
    expect(dublinLocalToUtc('2026-10-25T01:30')).toBe('2026-10-25T00:30:00.000Z')
  })

  it('rejects input that is not a date and time', () => {
    expect(() => dublinLocalToUtc('')).toThrow()
    expect(() => dublinLocalToUtc('next tuesday')).toThrow()
    expect(() => dublinLocalToUtc('2026-13-40T25:00')).toThrow()
  })
})

describe('utcToDublinLocal', () => {
  it('shows summer and winter times as Dublin clock time', () => {
    expect(utcToDublinLocal('2026-10-10T10:00:00Z')).toBe('2026-10-10T11:00')
    expect(utcToDublinLocal('2026-12-05T11:00:00Z')).toBe('2026-12-05T11:00')
  })

  it('understands the timestamp format the database returns', () => {
    expect(utcToDublinLocal('2026-10-10 10:00:00+00')).toBe('2026-10-10T11:00')
  })

  it('round-trips every hour of 2026 (except the repeated hour in October)', () => {
    const repeated = Date.UTC(2026, 9, 25, 1)
    for (let t = Date.UTC(2026, 0, 1); t < Date.UTC(2027, 0, 1); t += 3_600_000) {
      if (t === repeated) continue
      const iso = new Date(t).toISOString()
      expect(dublinLocalToUtc(utcToDublinLocal(iso))).toBe(iso)
    }
  })
})
