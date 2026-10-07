import { normalizeForMatch } from '../utils/text.utils';

/**
 * Concept enrichment: when any trigger appears anywhere in a record's text, its ES + EN tags are
 * added to `concepts[]` (a high-priority searchable attribute). This makes "pescado" find a
 * restaurant whose menu only says "trucha", or "pool" find a lodging whose facility says
 * "Piscina", independently of Algolia synonyms. Tags also feed the "why it matched" chips.
 *
 * Triggers are matched on accent-free lowercase text with word boundaries. Keep them specific:
 * a false positive here pushes a record up for unrelated queries.
 */
export interface SearchConcept {
  key: string;
  tags: { es: string[]; en: string[] };
  triggers: string[];
}

export const SEARCH_CONCEPTS: SearchConcept[] = [
  // --- Food ---
  {
    key: 'fish',
    tags: { es: ['pescado', 'pescados y mariscos'], en: ['fish', 'seafood'] },
    triggers: [
      'pescado',
      'trucha',
      'tilapia',
      'mojarra',
      'bagre',
      'bocachico',
      'salmon',
      'atun',
      'robalo',
      'corvina',
      'pargo',
      'ceviche',
      'camaron',
      'camarones',
      'mariscos',
      'langostino',
      'pulpo',
      'calamar',
      'fish',
      'seafood',
      'trout',
    ],
  },
  {
    key: 'meat',
    tags: { es: ['carnes', 'parrilla', 'asados'], en: ['meat', 'grill', 'steakhouse'] },
    triggers: [
      'carne',
      'carnes',
      'res',
      'lomo',
      'churrasco',
      'punta de anca',
      'costilla',
      'parrilla',
      'asado',
      'steak',
      'chicharron',
      'cerdo',
      'pulled pork',
    ],
  },
  {
    key: 'chicken',
    tags: { es: ['pollo'], en: ['chicken'] },
    triggers: ['pollo', 'pechuga', 'alitas', 'wings', 'chicken'],
  },
  {
    key: 'burger',
    tags: { es: ['hamburguesas'], en: ['burgers'] },
    triggers: ['hamburguesa', 'hamburguesas', 'burger', 'burgers'],
  },
  {
    key: 'pizza',
    tags: { es: ['pizza', 'pizzeria'], en: ['pizza'] },
    triggers: ['pizza', 'pizzas', 'pizzeria'],
  },
  {
    key: 'pasta',
    tags: { es: ['pastas', 'comida italiana'], en: ['pasta', 'italian food'] },
    triggers: ['pasta', 'pastas', 'lasagna', 'lasana', 'spaghetti', 'fettuccine', 'ravioli', 'italiana', 'risotto'],
  },
  {
    key: 'colombian',
    tags: { es: ['comida tipica', 'comida colombiana'], en: ['traditional food', 'colombian food'] },
    triggers: [
      'bandeja paisa',
      'tipica',
      'tipico',
      'sancocho',
      'frijoles',
      'arepa',
      'arepas',
      'mondongo',
      'ajiaco',
      'tamal',
      'colombiana',
      'paisa',
      'corrientazo',
      'almuerzo ejecutivo',
    ],
  },
  {
    key: 'vegetarian',
    tags: { es: ['vegetariano', 'vegano', 'saludable'], en: ['vegetarian', 'vegan', 'healthy'] },
    triggers: [
      'vegetariano',
      'vegetariana',
      'vegano',
      'vegana',
      'vegan',
      'vegetarian',
      'bowl',
      'bowls',
      'ensalada',
      'ensaladas',
      'saludable',
      'healthy',
      'plant based',
    ],
  },
  {
    key: 'breakfast',
    tags: { es: ['desayuno', 'brunch'], en: ['breakfast', 'brunch'] },
    triggers: ['desayuno', 'desayunos', 'brunch', 'breakfast', 'calentado', 'huevos'],
  },
  {
    key: 'coffee',
    tags: { es: ['cafe', 'cafeteria'], en: ['coffee', 'coffee shop'] },
    triggers: ['cafe', 'cafeteria', 'capuchino', 'cappuccino', 'espresso', 'latte', 'tinto', 'coffee'],
  },
  {
    key: 'dessert',
    tags: { es: ['postres', 'helados', 'reposteria'], en: ['desserts', 'ice cream', 'bakery'] },
    triggers: [
      'postre',
      'postres',
      'helado',
      'helados',
      'torta',
      'tortas',
      'brownie',
      'cheesecake',
      'reposteria',
      'pasteleria',
      'crepes',
      'waffles',
      'dessert',
    ],
  },
  {
    key: 'bakery',
    tags: { es: ['panaderia', 'pan'], en: ['bakery', 'bread'] },
    triggers: ['panaderia', 'pan', 'pandebono', 'bunuelo', 'bunuelos', 'almojabana', 'bakery'],
  },
  {
    key: 'drinks',
    tags: { es: ['bar', 'cocteles', 'cerveza'], en: ['bar', 'cocktails', 'beer'] },
    triggers: [
      'bar',
      'coctel',
      'cocteles',
      'cocktail',
      'cocktails',
      'cerveza',
      'cervezas',
      'beer',
      'vino',
      'vinos',
      'wine',
      'licores',
      'gastrobar',
    ],
  },
  {
    key: 'fast_food',
    tags: { es: ['comida rapida'], en: ['fast food'] },
    triggers: [
      'comida rapida',
      'perro caliente',
      'perros calientes',
      'hot dog',
      'salchipapa',
      'salchipapas',
      'empanada',
      'empanadas',
      'papas fritas',
      'fries',
      'sandwich',
    ],
  },
  {
    key: 'kids_menu',
    tags: { es: ['menu infantil'], en: ['kids menu'] },
    triggers: ['menu infantil', 'menu ninos', 'kids menu'],
  },
  {
    key: 'delivery',
    tags: { es: ['domicilios'], en: ['delivery'] },
    triggers: ['domicilio', 'domicilios', 'delivery', 'a domicilio'],
  },

  // --- Lodging amenities ---
  {
    key: 'pool',
    tags: { es: ['piscina'], en: ['pool', 'swimming pool'] },
    triggers: ['piscina', 'piscinas', 'alberca', 'pileta', 'pool', 'swimming pool'],
  },
  {
    key: 'jacuzzi',
    tags: { es: ['jacuzzi', 'hidromasaje'], en: ['jacuzzi', 'hot tub'] },
    triggers: ['jacuzzi', 'jacuzzis', 'hidromasaje', 'tina', 'hot tub', 'spa'],
  },
  {
    key: 'wifi',
    tags: { es: ['wifi', 'internet'], en: ['wifi', 'internet'] },
    triggers: ['wifi', 'wi fi', 'internet', 'fibra optica'],
  },
  {
    key: 'parking',
    tags: { es: ['parqueadero', 'estacionamiento'], en: ['parking'] },
    triggers: ['parqueadero', 'parqueaderos', 'estacionamiento', 'parking', 'garaje'],
  },
  {
    key: 'pets',
    tags: { es: ['mascotas', 'pet friendly'], en: ['pet friendly', 'pets allowed'] },
    triggers: ['mascota', 'mascotas', 'pet friendly', 'petfriendly', 'perros', 'pets'],
  },
  {
    key: 'air_conditioning',
    tags: { es: ['aire acondicionado'], en: ['air conditioning'] },
    triggers: ['aire acondicionado', 'air conditioning', 'a/c'],
  },
  {
    key: 'hot_water',
    tags: { es: ['agua caliente'], en: ['hot water'] },
    triggers: ['agua caliente', 'hot water'],
  },
  {
    key: 'kitchen',
    tags: { es: ['cocina'], en: ['kitchen'] },
    triggers: ['cocina equipada', 'cocina compartida', 'cocineta', 'kitchen', 'con cocina'],
  },
  {
    key: 'bbq_area',
    tags: { es: ['zona bbq', 'asador'], en: ['bbq area'] },
    triggers: ['zona bbq', 'asador', 'zona de asados', 'kiosko', 'kiosco', 'bbq area'],
  },
  {
    key: 'camping',
    tags: { es: ['camping', 'glamping'], en: ['camping', 'glamping'] },
    triggers: ['camping', 'glamping', 'zona de camping', 'carpa', 'carpas', 'tent'],
  },
  {
    key: 'cabin',
    tags: { es: ['cabana', 'cabanas'], en: ['cabin', 'cabins'] },
    triggers: ['cabana', 'cabanas', 'cabin', 'cabins', 'chalet'],
  },
  {
    key: 'family',
    tags: { es: ['familiar', 'ninos'], en: ['family friendly', 'kids'] },
    triggers: [
      'familia',
      'familiar',
      'familias',
      'ninos',
      'nino',
      'infantil',
      'kids',
      'family',
      'parque infantil',
      'juegos',
    ],
  },
  {
    key: 'romantic',
    tags: { es: ['romantico', 'parejas'], en: ['romantic', 'couples'] },
    triggers: ['romantico', 'romantica', 'pareja', 'parejas', 'luna de miel', 'romantic', 'couple', 'couples'],
  },
  {
    key: 'events',
    tags: { es: ['eventos', 'reuniones'], en: ['events', 'meetings'] },
    triggers: ['eventos', 'salon de eventos', 'reuniones', 'convenciones', 'bodas', 'events', 'weddings'],
  },

  // --- Nature & activities ---
  {
    key: 'river',
    // Not "natural pool": its word "pool" would make every river spot match "piscina"/"pool".
    tags: { es: ['rio', 'charco'], en: ['river', 'swimming hole'] },
    triggers: ['rio', 'rios', 'charco', 'charcos', 'quebrada', 'acceso al rio', 'river', 'balneario', 'playa del rio'],
  },
  {
    key: 'waterfall',
    tags: { es: ['cascada', 'cascadas'], en: ['waterfall', 'waterfalls'] },
    triggers: ['cascada', 'cascadas', 'salto', 'chorro', 'waterfall', 'waterfalls'],
  },
  {
    key: 'water_sports',
    tags: { es: ['deportes acuaticos', 'tubing', 'rafting'], en: ['water sports', 'tubing', 'rafting'] },
    triggers: [
      'tubing',
      'rafting',
      'kayak',
      'canoa',
      'paddle',
      'canyoning',
      'barranquismo',
      'torrentismo',
      'water sports',
    ],
  },
  {
    key: 'hiking',
    tags: { es: ['senderismo', 'caminata'], en: ['hiking', 'trekking'] },
    triggers: [
      'senderismo',
      'sendero',
      'senderos',
      'caminata',
      'caminatas',
      'trekking',
      'hiking',
      'trail',
      'ruta ecologica',
    ],
  },
  {
    key: 'birdwatching',
    tags: { es: ['avistamiento de aves', 'aves'], en: ['birdwatching', 'birds'] },
    triggers: ['aves', 'avistamiento', 'observacion de aves', 'pajaros', 'birdwatching', 'birding'],
  },
  {
    key: 'viewpoint',
    tags: { es: ['mirador', 'vista'], en: ['viewpoint', 'scenic view'] },
    triggers: ['mirador', 'miradores', 'vista panoramica', 'vista al embalse', 'viewpoint', 'panoramic'],
  },
  {
    key: 'reservoir',
    tags: { es: ['embalse', 'represa'], en: ['reservoir', 'lake'] },
    triggers: ['embalse', 'represa', 'lago', 'laguna', 'reservoir', 'lake'],
  },
  {
    key: 'adventure',
    tags: { es: ['aventura', 'extremo'], en: ['adventure', 'extreme'] },
    triggers: [
      'aventura',
      'extremo',
      'escalada',
      'rappel',
      'canopy',
      'tirolesa',
      'parapente',
      'adventure',
      'climbing',
      'zipline',
    ],
  },
  {
    key: 'nature',
    tags: { es: ['naturaleza', 'ecoturismo'], en: ['nature', 'ecotourism'] },
    triggers: [
      'naturaleza',
      'ecoturismo',
      'ecologico',
      'bosque',
      'reserva natural',
      'selva',
      'nature',
      'eco lodge',
      'ecolodge',
      'ecohotel',
    ],
  },
  {
    key: 'horse',
    tags: { es: ['cabalgata', 'caballos'], en: ['horseback riding'] },
    triggers: ['cabalgata', 'cabalgatas', 'caballo', 'caballos', 'horseback', 'horse'],
  },
  {
    key: 'culture',
    tags: { es: ['cultura', 'historia'], en: ['culture', 'history'] },
    triggers: [
      'iglesia',
      'museo',
      'historia',
      'historico',
      'patrimonio',
      'cultural',
      'artesanias',
      'church',
      'museum',
      'history',
    ],
  },
  {
    key: 'swim',
    tags: { es: ['para nadar', 'banarse'], en: ['swimming'] },
    triggers: ['nadar', 'banarse', 'swim', 'swimming', 'balneario'],
  },

  // --- Transport ---
  {
    key: 'mototaxi',
    tags: { es: ['mototaxi', 'motocarro'], en: ['tuk tuk', 'moto taxi'] },
    triggers: ['mototaxi', 'motocarro', 'moto carro', 'tuk tuk', 'tuktuk'],
  },
  {
    key: 'cargo',
    tags: { es: ['acarreos', 'carga', 'trasteos'], en: ['cargo', 'moving'] },
    triggers: ['carga', 'acarreo', 'acarreos', 'trasteo', 'trasteos', 'mudanza', 'cargo'],
  },
];

interface CompiledConcept {
  tags: string[];
  pattern: RegExp;
}

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

const COMPILED: CompiledConcept[] = SEARCH_CONCEPTS.map(concept => ({
  tags: [...concept.tags.es, ...concept.tags.en],
  pattern: new RegExp(
    `(^|[^a-z0-9])(${concept.triggers.map(t => escape(normalizeForMatch(t))).join('|')})(?=$|[^a-z0-9])`,
  ),
}));

/** Concept tags (ES + EN) whose triggers appear in the given text. */
export function extractConcepts(text: string): string[] {
  const haystack = normalizeForMatch(text);
  const tags = new Set<string>();
  for (const concept of COMPILED) {
    if (concept.pattern.test(haystack)) concept.tags.forEach(tag => tags.add(tag));
  }
  return [...tags];
}
