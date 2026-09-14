import type { Trip } from '../shared/types.ts';

// RFC 5545 text escaping and byte-aware folding, including multibyte place names.
function escapeText(value: string) {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r/g, '');
}
function fold(value: string) {
  const lines: string[] = [];
  let line = '';
  let bytes = 0;
  for (const char of value) {
    const size = Buffer.byteLength(char);
    if (bytes + size > 75) {
      lines.push(line);
      line = ' ';
      bytes = 1;
    }
    line += char;
    bytes += size;
  }
  lines.push(line);
  return lines.join('\r\n');
}
function compactDate(date: Date) {
  return date.toISOString().slice(0, 10).replaceAll('-', '');
}
export function tripCalendar(trip: Trip) {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Asktara//Trip Planner//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(trip.title)}`,
  ];
  for (const day of trip.itinerary) {
    const date = new Date(trip.startDate + 'T00:00:00Z');
    date.setUTCDate(date.getUTCDate() + day.day - 1);
    for (const item of day.items) {
      const [hours, minutes] = item.time.split(':').map(Number);
      const end = new Date(date);
      end.setUTCHours(hours, minutes + (item.durationMinutes ?? 60));
      // Floating local times intentionally follow the destination's wall clock.
      lines.push(
        'BEGIN:VEVENT',
        `UID:${trip.id}-${item.id}@asktara`,
        `DTSTAMP:${stamp}`,
        `DTSTART:${compactDate(date)}T${item.time.replace(':', '')}00`,
        `DTEND:${compactDate(end)}T${String(end.getUTCHours()).padStart(2, '0')}${String(end.getUTCMinutes()).padStart(2, '0')}00`,
        `SUMMARY:${escapeText(item.title)}`,
        `DESCRIPTION:${escapeText(item.description + '\nPlanning estimate only. Check opening hours and reservations before traveling.')}`,
        `LOCATION:${escapeText(item.location)}`,
        'END:VEVENT',
      );
    }
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
