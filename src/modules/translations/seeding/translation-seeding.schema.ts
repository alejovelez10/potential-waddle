import { Schema, SchemaType } from '@google/generative-ai';

/**
 * Builds a Gemini responseSchema that covers all translatable fields for a given entity
 * in a single structured call.
 *
 * fieldNames: e.g. ['description', 'howToGetThere'] for lodging.
 * Each property is a SchemaType.STRING (plain text, never markdown).
 *
 * Pattern: identical to structuredReviewAnalysisSchema but for plain-text translation fields.
 */
export function buildTranslationSchema(fieldNames: string[]): Schema {
  const properties: { [k: string]: Schema } = {};
  for (const field of fieldNames) {
    properties[field] = { type: SchemaType.STRING } as Schema;
  }
  return {
    type: SchemaType.OBJECT,
    required: fieldNames,
    properties,
  };
}

/**
 * Builds the translation prompt for a given entity.
 *
 * Embeds entity type, name, and ES field values. Instructs Gemini to:
 *   - Preserve proper nouns, business names, veredas, addresses.
 *   - Translate ONLY field values (not keys).
 *   - Output ONLY JSON conforming to the provided schema.
 *   - Do NOT translate the keys.
 */
export function buildTranslationPrompt(
  entityType: string,
  entityName: string,
  fieldsES: Record<string, string>,
): string {
  const fieldLines = Object.entries(fieldsES)
    .map(([k, v]) => `  "${k}": ${JSON.stringify(v)}`)
    .join('\n');

  return `You are a professional travel content translator. Translate the following Spanish text fields
for a Colombian tourism business (type: ${entityType}, name: "${entityName}") into natural, friendly English
for international travelers.

RULES:
1. Translate ONLY the field values provided. Do NOT translate the keys.
2. Preserve proper nouns: business names, neighborhood names (veredas), street addresses, place names (e.g., "Parque Nacional Natural"), and geographic references. Keep them in Spanish.
3. Do NOT translate addresses, directional references (e.g., "a 200m del parque"), or WhatsApp numbers.
4. Keep the tone friendly, inviting, and natural — as if writing for a travel platform like Airbnb or TripAdvisor.
5. Do NOT add markdown formatting (no **bold**, no bullet points unless they existed in the source).
6. Output ONLY the JSON object with the translated field values, conforming exactly to the provided schema.

Fields to translate:
{
${fieldLines}
}`;
}
