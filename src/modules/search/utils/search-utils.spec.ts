import { extractConcepts } from '../config/search-concepts';
import { buildHourSlots } from './hour-slots';
import { acceptsCard, normalizeLanguages } from './languages.utils';
import { flattenMenu } from './menu.utils';
import { cleanList, dailyShuffle, truncate } from './text.utils';

describe('flattenMenu', () => {
  it('flattens the Anthropic shape recursively (dishes + sections)', () => {
    const menu = flattenMenu({
      categories: [
        {
          category_name: 'Platos fuertes',
          products: [
            {
              product_name: 'Trucha al ajillo',
              product_price: 32000,
              product_description: 'Trucha de criadero en salsa de ajo',
            },
            { product_name: 'Churrasco', product_price: 38000 },
          ],
          subcategories: [{ category_name: 'Del río', products: [{ product_name: 'Mojarra frita' }] }],
        },
      ],
    });
    expect(menu.sections).toEqual(['Platos fuertes', 'Del río']);
    expect(menu.dishes).toEqual([
      'Trucha al ajillo — Trucha de criadero en salsa de ajo',
      'Churrasco',
      'Mojarra frita',
    ]);
  });

  it('accepts the legacy Kmizen shape', () => {
    const menu = flattenMenu({
      categories: [{ category_name: 'Ensaladas', items: [{ name: 'César', price: 25000 }] }],
    });
    expect(menu).toEqual({ dishes: ['César'], sections: ['Ensaladas'] });
  });

  it('returns empty lists for missing or malformed data', () => {
    expect(flattenMenu(null)).toEqual({ dishes: [], sections: [] });
    expect(flattenMenu({ categories: 'nope' })).toEqual({ dishes: [], sections: [] });
  });
});

describe('buildHourSlots', () => {
  it('covers every hour touched by a daytime range', () => {
    expect(buildHourSlots('08:00', '12:30')).toEqual(['h8', 'h9', 'h10', 'h11', 'h12']);
  });

  it('wraps ranges that cross midnight', () => {
    expect(buildHourSlots('22:00', '02:00')).toEqual(['h22', 'h23', 'h0', 'h1']);
  });

  it('returns no slots for unknown schedules', () => {
    expect(buildHourSlots('19:33', '19:33')).toEqual([]);
    expect(buildHourSlots(null, '10:00')).toEqual([]);
    expect(buildHourSlots('25:00', '10:00')).toEqual([]);
  });
});

describe('languages & payment', () => {
  it('normalizes the mixed spoken-language spellings to ISO codes', () => {
    expect(normalizeLanguages(['Inglés', 'Español.', 'es', 'fr', 'xx', null])).toEqual(['en', 'es', 'fr']);
  });

  it('detects card payments (card / datafono)', () => {
    expect(acceptsCard(['cash', 'datafono'])).toBe(true);
    expect(acceptsCard(['cash', 'nequi'])).toBe(false);
  });
});

describe('extractConcepts', () => {
  it('maps specific dishes to the generic "pescado" concept in ES and EN', () => {
    const concepts = extractConcepts('Trucha al ajillo — Trucha de criadero');
    expect(concepts).toEqual(expect.arrayContaining(['pescado', 'fish', 'seafood']));
  });

  it('maps the Piscina facility to pool', () => {
    expect(extractConcepts('Piscina climatizada')).toEqual(expect.arrayContaining(['piscina', 'pool']));
  });

  it('ignores accents and case', () => {
    expect(extractConcepts('CAMARÓN apanado')).toContain('pescado');
  });

  it('does not match inside other words or on known false positives', () => {
    expect(extractConcepts('BBQ areas, zona de descanso')).not.toContain('carnes');
    expect(extractConcepts('Baño privado con agua caliente')).not.toContain('para nadar');
    expect(extractConcepts('Paneles solares')).not.toContain('panaderia');
  });
});

describe('text utils', () => {
  it('cleans, trims and dedupes lists ignoring accents/case', () => {
    expect(cleanList([' Desayuno incluido', 'desayuno incluido.', '', null, 'Parqueadero'])).toEqual([
      'Desayuno incluido',
      'Parqueadero',
    ]);
  });

  it('truncates at a word boundary', () => {
    expect(truncate('uno dos tres cuatro cinco', 12)).toBe('uno dos tres…');
  });

  it('gives a stable daily rotation that changes across days', () => {
    expect(dailyShuffle('abc', '2026-10-06')).toBe(dailyShuffle('abc', '2026-10-06'));
    expect(dailyShuffle('abc', '2026-10-06')).not.toBe(dailyShuffle('abc', '2026-10-07'));
    expect(dailyShuffle('abc', '2026-10-06')).toBeLessThan(10_000);
  });
});
