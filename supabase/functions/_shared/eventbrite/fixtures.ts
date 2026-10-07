// Shared test data.
import type { EventRecord } from './types.ts'

export const inPersonEvent: EventRecord = {
  id: 'ev-1',
  title: 'Support Group – Mayo',
  summary: 'Monthly peer support',
  description: 'All welcome.\n\nTea & coffee <provided>.',
  website_title: null,
  website_text: 'A short note for the website.',
  website_location: null,
  website_post_id: null,
  starts_at: '2026-10-10T10:00:00+00:00',
  ends_at: '2026-10-10T12:00:00+00:00',
  timezone: 'Europe/Dublin',
  is_online: false,
  public_area: 'Castlebar',
  venue_name: 'Community Centre',
  venue_address: '1 Main St, Castlebar',
  capacity: 12,
  category: 'support_group',
  cover_image_path: null,
  status: 'draft',
}
