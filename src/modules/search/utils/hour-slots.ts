/**
 * Transport availability as hour slots ("h0".."h23", Colombia time) so "Disponible ahora" is a
 * plain facet filter (`hourSlots:h19`). Ranges that cross midnight (20:00–02:00) wrap around,
 * which a numeric start/end filter could not express.
 *
 * A slot is included when any minute of that hour falls inside the range.
 * Equal or unparseable times → no slots (unknown schedule, never shown as "available now").
 */
function parseMinutes(value: string | null | undefined): number | null {
  const match = /^(\d{1,2}):(\d{2})/.exec((value ?? '').trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

export function buildHourSlots(startTime: string | null | undefined, endTime: string | null | undefined): string[] {
  const start = parseMinutes(startTime);
  const end = parseMinutes(endTime);
  if (start === null || end === null || start === end) return [];

  const slots: string[] = [];
  const total = end > start ? end - start : 24 * 60 - start + end;
  const firstHour = Math.floor(start / 60);
  const lastMinute = start + total - 1;
  for (let minute = firstHour * 60; minute <= lastMinute; minute += 60) {
    slots.push(`h${Math.floor(minute / 60) % 24}`);
  }
  return [...new Set(slots)];
}
