/**
 * Deterministic fake Gemini translation responses for seeding specs.
 * NO network calls, NO @google/generative-ai import — pure data helper.
 *
 * Used by specs via:
 *   jest.mock('../../ai/lib/gemini/generate-structured-with-fallback');
 *   (generateStructuredAnalysis as jest.Mock).mockResolvedValue(fakeGeminiJson(fieldsES));
 */

/** Deterministic EN translations keyed by ES field name. Simulates generateStructuredAnalysis raw JSON output. */
export const FAKE_TRANSLATION_EN: Record<string, string> = {
  description: 'A cozy cabin surrounded by nature.',
  howToGetThere: 'Take the main road 200m past the park.',
  biography: 'An experienced guide with over 10 years exploring Colombian highlands.',
  departureDescription: 'We depart from the central square at 8am.',
  arrivalDescription: 'We arrive at the summit viewpoint after a 3-hour hike.',
};

/**
 * Returns the JSON string generateStructuredAnalysis would return for the given fields.
 * Only echoes translations for keys present in fieldsES (so buildTranslationSchema(required) is honored).
 * Falls back to a synthetic EN string for unknown keys.
 */
export function fakeGeminiJson(fieldsES: Record<string, string>): string {
  const out: Record<string, string> = {};
  for (const key of Object.keys(fieldsES)) {
    out[key] = FAKE_TRANSLATION_EN[key] ?? `EN(${fieldsES[key]})`;
  }
  return JSON.stringify(out);
}
