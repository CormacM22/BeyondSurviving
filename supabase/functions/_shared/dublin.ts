// Irish clock time for a stored UTC timestamp, in the formats the website's
// Event Details fields use: date Ymd ("20261019") and time H:i:s ("19:00:00").

const parts = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Dublin',
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

export function dublinDateTime(utc: string): { date: string; time: string } {
  const ms = Date.parse(utc.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00'))
  if (Number.isNaN(ms)) throw new Error(`Not a timestamp: "${utc}"`)
  const p = Object.fromEntries(parts.formatToParts(ms).map((x) => [x.type, x.value]))
  return { date: `${p.year}${p.month}${p.day}`, time: `${p.hour}:${p.minute}:${p.second}` }
}
