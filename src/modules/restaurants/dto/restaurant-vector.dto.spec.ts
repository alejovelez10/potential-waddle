/**
 * Shape + PII spec for RestaurantVectorDto (T-04.1-07 / T-04.1-08).
 *
 * Guards the silent-drop pitfall: asserts the newly enriched keys (menu singular
 * flattened, priceRanges, safe reviews array) are actually mapped, and that no
 * reviewer identity (email/user.id) leaks into any reviews[] element.
 */

import { RestaurantVectorDto } from './restaurant-vector.dto';
import { Restaurant } from '../entities';
import { ReviewStatusEnum } from '../../reviews/enums';

function makeRestaurant(overrides: Partial<Restaurant> = {}): Restaurant {
  return {
    id: 'rest-1',
    name: 'El Peñón Parrilla',
    slug: 'el-penon-parrilla',
    description: 'Parrilla típica.',
    rating: 4.6,
    reviewCount: 128,
    points: 0,
    spokenLanguages: ['es'],
    address: 'Cra 5 #12-30',
    phoneNumbers: [],
    whatsappNumbers: [],
    openingHours: [],
    location: { type: 'Point', coordinates: [-75.0281, 6.2932] },
    isPublic: true,
    categories: [],
    facilities: [],
    paymentMethods: ['cash'],
    menus: [{ data: { restaurant_name: 'El Peñón Parrilla', currency: 'COP', categories: [] } }],
    priceRanges: [
      { label: 'Entradas', priceFrom: 8000, featured: false },
      { label: 'Fuertes', priceFrom: 25000, featured: true },
    ],
    reviews: [
      {
        id: 'r1',
        rating: 5,
        comment: 'La mejor bandeja paisa.',
        isPublic: true,
        status: ReviewStatusEnum.APPROVED,
        createdAt: new Date('2026-05-14T18:22:00Z'),
        user: { id: 'u1', email: 'camilo@example.com', username: 'Camilo R.' },
      },
      {
        id: 'r2',
        rating: 1,
        comment: 'Pendiente, no exponer.',
        isPublic: true,
        status: ReviewStatusEnum.PENDING,
        createdAt: new Date('2026-04-02T13:10:00Z'),
        user: { id: 'u2', email: 'troll@example.com', username: 'Troll' },
      },
    ],
    ...overrides,
  } as unknown as Restaurant;
}

describe('RestaurantVectorDto', () => {
  it('maps the singular flattened carta (menu = menus[0].data)', () => {
    const dto = new RestaurantVectorDto({ data: makeRestaurant() });
    expect(dto.menu).toEqual({ restaurant_name: 'El Peñón Parrilla', currency: 'COP', categories: [] });
  });

  it('maps priceRanges', () => {
    const dto = new RestaurantVectorDto({ data: makeRestaurant() });
    expect(dto.priceRanges).toHaveLength(2);
    expect(dto.priceRanges?.[1]).toEqual({ label: 'Fuertes', priceFrom: 25000, featured: true });
  });

  it('projects only approved+public reviews to a safe shape', () => {
    const dto = new RestaurantVectorDto({ data: makeRestaurant() });
    expect(dto.reviews).toHaveLength(1);
    expect(dto.reviews?.[0]).toEqual({
      rating: 5,
      comment: 'La mejor bandeja paisa.',
      authorDisplayName: 'Camilo R.',
      createdAt: new Date('2026-05-14T18:22:00Z'),
    });
  });

  it('never leaks reviewer email/id inside a review element', () => {
    const dto = new RestaurantVectorDto({ data: makeRestaurant() });
    const review = dto.reviews?.[0] as unknown as Record<string, unknown>;
    expect(review.user).toBeUndefined();
    expect(review.email).toBeUndefined();
    expect(review.id).toBeUndefined();
  });

  it('handles missing menu/reviews gracefully', () => {
    const dto = new RestaurantVectorDto({ data: makeRestaurant({ menus: undefined, reviews: undefined }) });
    expect(dto.menu).toBeNull();
    expect(dto.reviews).toEqual([]);
  });
});
