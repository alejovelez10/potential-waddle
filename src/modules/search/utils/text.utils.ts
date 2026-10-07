import { createHash } from 'crypto';

/** Lowercase + strip accents, for regex matching (concepts) and dedupe keys. */
export function normalizeForMatch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/** Trim, drop empties and dedupe (accent/case-insensitive), keeping the first spelling. */
export function cleanList(values: (string | null | undefined)[] | null | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values ?? []) {
    const value = (raw ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[.,;]+$/, '');
    if (!value) continue;
    const key = normalizeForMatch(value);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

/** Cut at a word boundary, adding an ellipsis when the text was longer. */
export function truncate(value: string | null | undefined, max: number): string {
  const text = (value ?? '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}

/** Join the non-empty parts of a text block with blank lines. */
export function joinText(parts: (string | null | undefined)[]): string {
  return parts
    .map(p => (p ?? '').trim())
    .filter(Boolean)
    .join('\n\n');
}

/** Numeric columns arrive as strings from pg (numeric) — coerce, keeping null for "no value". */
export function toNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export function roundTo(value: number, decimals = 1): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

/**
 * Stable daily rotation in [0, 9999]: the same id gets the same position all day, and a new one
 * tomorrow. Mirrors today's "random" default ordering without reshuffling on every request.
 */
export function dailyShuffle(id: string, day: string): number {
  const digest = createHash('sha1').update(`${id}:${day}`).digest();
  return digest.readUInt32BE(0) % 10_000;
}

/** YYYY-MM-DD in Colombia time (UTC-5, no DST). */
export function colombiaDay(now: Date = new Date()): string {
  return new Date(now.getTime() - 5 * 3600 * 1000).toISOString().slice(0, 10);
}
