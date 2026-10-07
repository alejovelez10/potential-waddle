import type { SynonymHit } from 'algoliasearch';

/**
 * Query-side synonyms (Grow plan). Complements `search-concepts.ts` (record-side enrichment):
 * concepts make records findable by category words; synonyms widen what the user typed.
 * Multi-way = all words equivalent. One-way = the input also searches the listed words.
 */
const MULTI_WAY: string[][] = [
  // ES ↔ EN
  ['cabaña', 'cabin', 'chalet'],
  ['cascada', 'waterfall', 'salto'],
  ['piscina', 'pool', 'alberca', 'pileta'],
  ['hospedaje', 'alojamiento', 'hotel', 'lodging', 'accommodation', 'stay'],
  ['restaurante', 'restaurant', 'comida', 'food'],
  ['guía', 'guide', 'guia turistico', 'tour guide'],
  ['transporte', 'transport', 'taxi'],
  ['comercio', 'tienda', 'store', 'shop'],
  ['experiencia', 'experience', 'actividad', 'activity', 'tour', 'plan'],
  ['río', 'river'],
  ['charco', 'natural pool', 'pozo'],
  ['mirador', 'viewpoint'],
  ['finca', 'casa campestre', 'casa de campo', 'farm stay'],
  ['desayuno', 'breakfast'],
  ['mascotas', 'pet friendly', 'pets'],
  ['parqueadero', 'estacionamiento', 'parking'],
  ['senderismo', 'caminata', 'hiking', 'trekking'],
  ['motocarro', 'mototaxi', 'tuk tuk', 'tuktuk'],
  ['iglesia', 'church', 'templo'],
  ['vegetariano', 'vegetarian', 'vegano', 'vegan'],
  ['hamburguesa', 'burger'],
  ['pollo', 'chicken'],
  ['carne', 'meat', 'res'],
  ['cerveza', 'beer', 'pola'],
  ['café', 'coffee', 'tinto'],
  ['helado', 'ice cream'],
  ['embalse', 'reservoir', 'represa'],
];

const ONE_WAY: { input: string; synonyms: string[] }[] = [
  {
    input: 'pescado',
    synonyms: ['trucha', 'mojarra', 'tilapia', 'bagre', 'bocachico', 'salmón', 'ceviche', 'mariscos'],
  },
  { input: 'fish', synonyms: ['trucha', 'mojarra', 'tilapia', 'bagre', 'salmón', 'ceviche'] },
  { input: 'mariscos', synonyms: ['camarón', 'camarones', 'langostinos', 'pulpo', 'calamar', 'ceviche'] },
  { input: 'seafood', synonyms: ['camarón', 'mariscos', 'ceviche', 'pescado'] },
  { input: 'comida típica', synonyms: ['bandeja paisa', 'sancocho', 'frijoles', 'arepa', 'mondongo'] },
  { input: 'agua', synonyms: ['río', 'charco', 'cascada', 'piscina', 'balneario'] },
  { input: 'nadar', synonyms: ['charco', 'piscina', 'balneario', 'río'] },
  { input: 'aventura', synonyms: ['tubing', 'canyoning', 'rafting', 'escalada', 'rappel', 'canopy'] },
  { input: 'adventure', synonyms: ['tubing', 'canyoning', 'rafting', 'climbing'] },
  { input: 'dormir', synonyms: ['hotel', 'hostal', 'cabaña', 'finca', 'glamping', 'hospedaje'] },
  { input: 'comer', synonyms: ['restaurante', 'comida', 'almuerzo', 'cena'] },
];

const slug = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-');

export function buildSynonyms(): SynonymHit[] {
  return [
    ...MULTI_WAY.map(words => ({ objectID: `syn-${slug(words[0])}`, type: 'synonym' as const, synonyms: words })),
    ...ONE_WAY.map(({ input, synonyms }) => ({
      objectID: `oneway-${slug(input)}`,
      type: 'onewaysynonym' as const,
      input,
      synonyms,
    })),
  ];
}
