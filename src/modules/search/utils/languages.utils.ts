import { normalizeForMatch } from './text.utils';

/** Spoken languages are stored inconsistently ("es", "Español.", "Inglés") — normalize to ISO. */
const LANGUAGE_ALIASES: Record<string, string> = {
  es: 'es',
  espanol: 'es',
  spanish: 'es',
  castellano: 'es',
  en: 'en',
  ingles: 'en',
  english: 'en',
  fr: 'fr',
  frances: 'fr',
  french: 'fr',
  pt: 'pt',
  portugues: 'pt',
  portuguese: 'pt',
  de: 'de',
  aleman: 'de',
  german: 'de',
  it: 'it',
  italiano: 'it',
  italian: 'it',
};

export function normalizeLanguages(values: (string | null | undefined)[] | null | undefined): string[] {
  const out = new Set<string>();
  for (const raw of values ?? []) {
    const key = normalizeForMatch((raw ?? '').replace(/[^\p{L}]/gu, ''));
    const iso = LANGUAGE_ALIASES[key];
    if (iso) out.add(iso);
  }
  return [...out];
}

/** Payment methods that mean "acepta tarjeta" on the cards' filter chip. */
const CARD_METHODS = new Set(['card', 'datafono', 'credit_card', 'debit_card']);

export function acceptsCard(methods: (string | null | undefined)[] | null | undefined): boolean {
  return (methods ?? []).some(m => CARD_METHODS.has((m ?? '').toLowerCase()));
}
