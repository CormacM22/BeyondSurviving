import { describe, expect, it } from 'vitest'
import { dublinDateTime } from './dublin.ts'

describe('dublinDateTime', () => {
  it('gives Irish clock time in summer (UTC+1)', () => {
    expect(dublinDateTime('2026-10-01T17:30:00Z')).toEqual({ date: '20261001', time: '18:30:00' })
  })

  it('gives Irish clock time in winter (UTC)', () => {
    expect(dublinDateTime('2026-12-05T19:00:00Z')).toEqual({ date: '20261205', time: '19:00:00' })
  })

  it('moves to the next day when the Irish time is past midnight', () => {
    expect(dublinDateTime('2026-07-01T23:30:00Z')).toEqual({ date: '20260702', time: '00:30:00' })
  })

  it('understands the timestamp format the database returns', () => {
    expect(dublinDateTime('2026-10-19 18:00:00+00')).toEqual({ date: '20261019', time: '19:00:00' })
  })
})
