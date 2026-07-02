/**
 * Shape + PII spec for LodgingVectorDto (T-04.1-07 / T-04.1-08).
 *
 * Asserts the enriched keys are mapped: full lodgingRoomTypes with FLAT image URL
 * strings, nearbyPlaces ({placeName, distance}) and a safe reviews array. Also
 * guards that no reviewer identity leaks into any reviews[] element.
 */

import { LodgingVectorDto } from './lodging-vector.dto';
import { Lodging } from '../entities';
import { ReviewStatusEnum } from '../../reviews/enums';

function makeLodging(overrides: Partial<Lodging> = {}): Lodging {
  return {
    id: 'lodg-1',
    name: 'Cabañas del Bosque',
    slug: 'cabanas-del-bosque',
    description: 'Cabañas de montaña.',
    rating: 4.8,
    reviewCount: 74,
    points: 0,
    roomCount: 2,
    town: undefined,
    user: undefined,
    categories: [],
    images: [],
    facilities: [],
    amenities: ['piscina'],
    roomTypes: ['Cabaña'],
    location: { type: 'Point', coordinates: [-75.0311, 6.301] },
    isPublic: true,
    showGoogleMapsReviews: true,
    showBinntuReviews: true,
    lodgingRoomTypes: [
      {
        name: 'Cabaña familiar',
        description: 'Dos pisos con chimenea.',
        price: 180000,
        maxCapacity: 6,
        bedCount: 3,
        bedType: 'mixta',
        roomSize: 45,
        bathroomType: 'privado',
        hasWifi: true,
        hasAirConditioning: false,
        hasKitchen: true,
        hasBalcony: true,
        view: 'bosque',
        amenities: ['chimenea'],
        images: [
          { imageResource: { url: 'https://cdn.binntu.com/l/room-1.jpg' } },
          { imageResource: { url: 'https://cdn.binntu.com/l/room-2.jpg' } },
        ],
      },
    ],
    places: [
      { place: { name: 'Charco El Silencio' }, distance: 1.2 },
      { place: { name: 'Mirador La Rápida' }, distance: 3.4 },
    ],
    reviews: [
      {
        id: 'r1',
        rating: 5,
        comment: 'Cabañas hermosas.',
        isPublic: true,
        status: ReviewStatusEnum.APPROVED,
        createdAt: new Date('2026-06-01T09:00:00Z'),
        user: { id: 'u1', email: 'laura@example.com', username: 'Laura M.' },
      },
      {
        id: 'r2',
        rating: 2,
        comment: 'Privada aprobada, no exponer.',
        isPublic: false,
        status: ReviewStatusEnum.APPROVED,
        createdAt: new Date('2026-06-02T09:00:00Z'),
        user: { id: 'u2', email: 'hidden@example.com', username: 'Hidden' },
      },
    ],
    ...overrides,
  } as unknown as Lodging;
}

describe('LodgingVectorDto', () => {
  it('maps full room types with FLAT image URL strings', () => {
    const dto = new LodgingVectorDto(makeLodging());
    expect(dto.lodgingRoomTypes).toHaveLength(1);
    const room = dto.lodgingRoomTypes?.[0];
    expect(room?.name).toBe('Cabaña familiar');
    expect(room?.hasWifi).toBe(true);
    expect(room?.images).toEqual([
      'https://cdn.binntu.com/l/room-1.jpg',
      'https://cdn.binntu.com/l/room-2.jpg',
    ]);
  });

  it('maps nearbyPlaces as {placeName, distance}', () => {
    const dto = new LodgingVectorDto(makeLodging());
    expect(dto.nearbyPlaces).toEqual([
      { placeName: 'Charco El Silencio', distance: 1.2 },
      { placeName: 'Mirador La Rápida', distance: 3.4 },
    ]);
  });

  it('projects only approved+public reviews to a safe shape without reviewer identity', () => {
    const dto = new LodgingVectorDto(makeLodging());
    expect(dto.reviews).toHaveLength(1);
    expect(dto.reviews?.[0]).toEqual({
      rating: 5,
      comment: 'Cabañas hermosas.',
      authorDisplayName: 'Laura M.',
      createdAt: new Date('2026-06-01T09:00:00Z'),
    });
    const review = dto.reviews?.[0] as unknown as Record<string, unknown>;
    expect(review.user).toBeUndefined();
    expect(review.email).toBeUndefined();
  });

  it('keeps the legacy roomTypes string array untouched', () => {
    const dto = new LodgingVectorDto(makeLodging());
    expect(dto.roomTypes).toEqual(['Cabaña']);
  });
});
