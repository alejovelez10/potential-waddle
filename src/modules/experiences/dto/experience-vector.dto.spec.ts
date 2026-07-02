/**
 * Shape + PII spec for ExperienceVectorDto (T-04.1-07 / T-04.1-08).
 *
 * Asserts the reviews field is now a SAFE ARRAY (previously a count), and that
 * departure/arrival Points are flattened to lat/long + description strings.
 * Guards that no reviewer identity leaks into any reviews[] element.
 */

import { ExperienceVectorDto } from './experience-vector.dto';
import { Experience } from '../entities';
import { ReviewStatusEnum } from '../../reviews/enums';

function makeExperience(overrides: Partial<Experience> = {}): Experience {
  return {
    id: 'exp-1',
    title: 'Caminata a Charco El Silencio',
    slug: 'caminata-charco',
    description: 'Caminata guiada.',
    difficultyLevel: 'media',
    price: 45000,
    priceLabel: 'por persona',
    additionalPrices: [],
    guide: undefined,
    travelTime: 0,
    totalDistance: 0,
    rating: 4.9,
    points: 0,
    town: undefined,
    isPublic: true,
    paymentMethods: [],
    departureLocation: { type: 'Point', coordinates: [-75.0281, 6.2932] },
    departureDescription: 'Parque principal.',
    arrivalLocation: { type: 'Point', coordinates: [-75.04, 6.287] },
    arrivalDescription: 'Charco El Silencio.',
    reviews: [
      {
        id: 'r1',
        rating: 5,
        comment: 'Experiencia inolvidable.',
        isPublic: true,
        status: ReviewStatusEnum.APPROVED,
        createdAt: new Date('2026-06-10T16:30:00Z'),
        user: { id: 'u1', email: 'julian@example.com', username: 'Julián T.' },
      },
      {
        id: 'r2',
        rating: 1,
        comment: 'Pendiente, no exponer.',
        isPublic: true,
        status: ReviewStatusEnum.PENDING,
        createdAt: new Date('2026-06-11T16:30:00Z'),
        user: { id: 'u2', email: 'troll@example.com', username: 'Troll' },
      },
    ],
    ...overrides,
  } as unknown as Experience;
}

describe('ExperienceVectorDto', () => {
  it('exposes reviews as a SAFE ARRAY (not a count)', () => {
    const dto = new ExperienceVectorDto({ data: makeExperience() });
    expect(Array.isArray(dto.reviews)).toBe(true);
    expect(dto.reviews).toHaveLength(1);
    expect(dto.reviews[0]).toEqual({
      rating: 5,
      comment: 'Experiencia inolvidable.',
      authorDisplayName: 'Julián T.',
      createdAt: new Date('2026-06-10T16:30:00Z'),
    });
  });

  it('flattens departure/arrival Points to lat/long + descriptions', () => {
    const dto = new ExperienceVectorDto({ data: makeExperience() });
    expect(dto.departureLongitude).toBe(-75.0281);
    expect(dto.departureLatitude).toBe(6.2932);
    expect(dto.departureDescription).toBe('Parque principal.');
    expect(dto.arrivalLongitude).toBe(-75.04);
    expect(dto.arrivalLatitude).toBe(6.287);
    expect(dto.arrivalDescription).toBe('Charco El Silencio.');
  });

  it('never leaks reviewer email/id inside a review element', () => {
    const dto = new ExperienceVectorDto({ data: makeExperience() });
    const review = dto.reviews[0] as unknown as Record<string, unknown>;
    expect(review.user).toBeUndefined();
    expect(review.email).toBeUndefined();
    expect(review.id).toBeUndefined();
  });

  it('handles missing reviews/locations gracefully', () => {
    const dto = new ExperienceVectorDto({
      data: makeExperience({ reviews: undefined, departureLocation: undefined, arrivalLocation: undefined }),
    });
    expect(dto.reviews).toEqual([]);
    expect(dto.departureLatitude).toBeUndefined();
    expect(dto.arrivalLongitude).toBeUndefined();
  });
});
