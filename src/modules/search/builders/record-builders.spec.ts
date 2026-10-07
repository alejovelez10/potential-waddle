import { MAX_RECORD_BYTES } from '../search.constants';
import { buildBaseRecord, byteSize, finalizeRecord } from './base-record';
import type { BuildContext } from './build-context';
import { experienceRecordBuilder } from './experience.record-builder';
import { lodgingRecordBuilder } from './lodging.record-builder';
import { placeRecordBuilder } from './place.record-builder';
import { restaurantRecordBuilder } from './restaurant.record-builder';
import { transportRecordBuilder } from './transport.record-builder';

const ID = '11111111-1111-4111-8111-111111111111';
const TOWN = {
  id: 't1',
  slug: 'sanrafael',
  name: 'San Rafael',
  department: 'Antioquia',
  isEnable: true,
  lat: 6.29,
  lng: -75.02,
};

function ctx(overrides: Partial<BuildContext> = {}): BuildContext {
  return {
    premiumIds: new Set(),
    verifiedIds: new Set(),
    promotions: new Map(),
    badges: new Map(),
    translations: new Map(),
    taxonomyEn: new Map(),
    day: '2026-10-06',
    now: new Date('2026-10-06T12:00:00Z'),
    ...overrides,
  };
}

const baseInput = (context: BuildContext) => ({
  type: 'lodging' as const,
  row: { id: ID, town: TOWN, categories: [], facilities: [], images: ['a.jpg', 'b.jpg'] },
  ctx: context,
  slug: 'hotel',
  path: '/lodgings/hotel',
  name: 'Hotel',
  description: { es: 'Hola', en: 'Hello' },
  details: { es: '', en: '' },
  binntuRating: 0,
  binntuCount: 0,
  googleRating: 4.6,
  googleCount: 120,
  showGoogleReviews: true,
});

describe('buildBaseRecord — freemium rules', () => {
  it('hides the Google rating and promotions for free businesses', () => {
    const record = buildBaseRecord({
      ...baseInput(ctx({ promotions: new Map([[ID, { value: 20, endsAt: 1 }]]) })),
    });
    expect(record.isPremium).toBe(false);
    expect(record.rating.google).toBeUndefined();
    expect(record.showGoogleReviews).toBe(false);
    expect(record.hasPromotion).toBe(false);
    expect(record.rank.boost).toBe(0);
  });

  it('exposes Google rating, promotion and boost for Premium', () => {
    const record = buildBaseRecord(
      baseInput(ctx({ premiumIds: new Set([ID]), promotions: new Map([[ID, { value: 20, endsAt: 1 }]]) })),
    );
    expect(record.isPremium).toBe(true);
    expect(record.rating).toMatchObject({ google: 4.6, googleCount: 120, display: 4.6 });
    expect(record.promotion).toEqual({ value: 20, endsAt: 1 });
    expect(record.rank.boost).toBe(1);
  });

  it('defaults townSlugs to the entity town and skips (0,0) coordinates', () => {
    const record = buildBaseRecord({ ...baseInput(ctx()), geo: { lat: 0, lng: 0 } });
    expect(record.townSlugs).toEqual(['sanrafael']);
    expect(record._geoloc).toBeUndefined();
    expect(record.image).toBe('a.jpg');
  });
});

describe('finalizeRecord', () => {
  it('trims huge menus under the size budget', () => {
    const record = buildBaseRecord(baseInput(ctx()));
    record.menu = {
      dishes: Array.from({ length: 2000 }, (_, i) => `Plato ${i} — ${'descripción muy larga '.repeat(4)}`),
      sections: [],
    };
    finalizeRecord(record);
    expect(byteSize(record)).toBeLessThanOrEqual(MAX_RECORD_BYTES);
  });
});

describe('visibility rules mirror the /public endpoints', () => {
  const now = new Date();

  it('lodging / restaurant: (published AND public) OR forced', () => {
    for (const builder of [lodgingRecordBuilder, restaurantRecordBuilder]) {
      expect(builder.isVisible({ status: 'published', is_public: true, forced_public: false } as never, now)).toBe(
        true,
      );
      expect(builder.isVisible({ status: 'draft', is_public: true, forced_public: false } as never, now)).toBe(false);
      expect(builder.isVisible({ status: 'draft', is_public: false, forced_public: true } as never, now)).toBe(true);
    }
  });

  it('experience also needs its guide published and public', () => {
    const row = {
      status: 'published',
      is_public: true,
      forced_public: false,
      guide_status: 'draft',
      guide_is_public: true,
    };
    expect(experienceRecordBuilder.isVisible(row as never, now)).toBe(false);
    expect(experienceRecordBuilder.isVisible({ ...row, guide_status: 'published' } as never, now)).toBe(true);
  });

  it('place: public OR forced (no status)', () => {
    expect(placeRecordBuilder.isVisible({ is_public: false, forced_public: false } as never, now)).toBe(false);
    expect(placeRecordBuilder.isVisible({ is_public: true, forced_public: false } as never, now)).toBe(true);
  });
});

describe('restaurant record', () => {
  it('makes menu dishes searchable and uses the featured price range', () => {
    const record = restaurantRecordBuilder.toRecord(
      {
        id: ID,
        name: 'Al Aire',
        slug: 'al-aire',
        town: TOWN,
        categories: [],
        facilities: [],
        images: [],
        price_ranges: [
          { label: 'Bebidas', priceFrom: 3000 },
          { label: 'Platos fuertes', priceFrom: 25000, featured: true },
        ],
        lowest_price: '3000',
        menu_data: { categories: [{ category_name: 'Del río', products: [{ product_name: 'Trucha al ajillo' }] }] },
        status: 'published',
        is_public: true,
        forced_public: false,
      } as never,
      ctx(),
    );
    expect(record.menu?.dishes).toContain('Trucha al ajillo');
    expect(record.concepts).toEqual(expect.arrayContaining(['pescado', 'fish']));
    expect(record.price).toMatchObject({ from: 25000, featuredLabel: 'Platos fuertes', unit: 'plato' });
    expect(record.hasMenu).toBe(true);
  });
});

describe('transport record — privacy and Premium-only data', () => {
  const row = {
    id: ID,
    first_name: 'Ana',
    last_name: 'Gómez',
    town: TOWN,
    categories: [],
    start_time: '20:00',
    end_time: '01:00',
    vehicle_model: 'Bajaj',
    capacity: 3,
    services: 'Acarreos, viajes a veredas',
    coverage_towns: [{ ...TOWN, id: 't2', slug: 'sancarlos', name: 'San Carlos' }],
    status: 'published',
    is_public: true,
    forced_public: false,
    profile_photo: { url: 'p.jpg' },
    // Private columns must never reach the record even if a query selected them.
    license_plate: 'ABC123',
    document: '123456',
    email: 'x@y.com',
  };

  it('never contains private columns', () => {
    const json = JSON.stringify(transportRecordBuilder.toRecord(row as never, ctx({ premiumIds: new Set([ID]) })));
    expect(json).not.toContain('ABC123');
    expect(json).not.toContain('123456');
    expect(json).not.toContain('x@y.com');
  });

  it('keeps vehicle, capacity, services and coverage for Premium only', () => {
    const free = transportRecordBuilder.toRecord(row as never, ctx());
    expect(free.vehicleModel).toBeUndefined();
    expect(free.capacity).toBeUndefined();
    expect(free.townSlugs).toEqual(['sanrafael']);

    const premium = transportRecordBuilder.toRecord(row as never, ctx({ premiumIds: new Set([ID]) }));
    expect(premium.vehicleModel).toBe('Bajaj');
    expect(premium.capacity).toBe(3);
    expect(premium.townSlugs).toEqual(['sanrafael', 'sancarlos']);
    expect(premium.hourSlots).toEqual(['h20', 'h21', 'h22', 'h23', 'h0']);
    expect(premium._geoloc).toBeUndefined();
  });
});
