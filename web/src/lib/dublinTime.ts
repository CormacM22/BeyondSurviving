// Event times are entered and shown as Irish clock time, whatever time zone the
// browser happens to be in, and stored in the database as exact UTC instants.
//
// "Local" values use the format of an <input type="datetime-local">: YYYY-MM-DDTHH:mm.

const TIME_ZONE = 'Europe/Dublin'
const DAY_MS = 86_400_000

const dublinParts = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

// Dublin clock time at a UTC instant, as the same digits read as if they were UTC.
function dublinWallMs(utcMs: number): number {
  const p = Object.fromEntries(dublinParts.formatToParts(utcMs).map((x) => [x.type, x.value]))
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute)
}

// How far Dublin is ahead of UTC at a given instant, in ms (0 in winter, 1h in summer).
function offsetMs(utcMs: number): number {
  return dublinWallMs(utcMs) - Math.floor(utcMs / 60_000) * 60_000
}

function parseLocal(local: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local)
  if (!m) throw new Error(`Not a date and time: "${local}"`)
  const [y, mo, d, h, mi] = m.slice(1).map(Number)
  const ms = Date.UTC(y, mo - 1, d, h, mi)
  const back = new Date(ms)
  if (back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d || h > 23 || mi > 59) {
    throw new Error(`Not a real date and time: "${local}"`)
  }
  return ms
}

/**
 * Dublin clock time → UTC ISO string.
 * A time that happens twice (clocks going back) means the first one.
 * A time that never happens (clocks going forward) moves forward an hour.
 */
export function dublinLocalToUtc(local: string): string {
  const wall = parseLocal(local)
  const before = offsetMs(wall - DAY_MS)
  const after = offsetMs(wall + DAY_MS)
  const matches = [...new Set([before, after])]
    .map((off) => wall - off)
    .filter((utc) => dublinWallMs(utc) === wall)
  const utc = matches.length ? Math.min(...matches) : wall - before
  return new Date(utc).toISOString()
}

/** UTC timestamp (ISO, or as the database returns it) → Dublin clock time. */
export function utcToDublinLocal(utc: string): string {
  const ms = Date.parse(utc.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00'))
  if (Number.isNaN(ms)) throw new Error(`Not a timestamp: "${utc}"`)
  return new Date(dublinWallMs(ms)).toISOString().slice(0, 16)
}
