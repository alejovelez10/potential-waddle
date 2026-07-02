/**
 * Unit spec for GuideVectorDto — guards the T-04.1-06 / T-04.1-07 trust boundary.
 *
 * The /public/full-info guides endpoint is UNAUTHENTICATED. This spec asserts:
 *  1. The pre-existing PII leak is CLOSED — national ID (document/documentType),
 *     email, phone, address and the mapped full `user` are NEVER serialized.
 *  2. Reviews are projected to a SAFE public shape ({rating, comment,
 *     authorDisplayName, createdAt}) and filtered to isPublic && APPROVED only —
 *     no reviewer email/id/username object survives.
 *  3. Safe business fields (name, biography, languages, social handles) are kept.
 */

import { GuideVectorDto } from './guide-vector.dto';
import { Guide } from '../entities/guide.entity';
import { ReviewStatusEnum } from '../../reviews/enums';

function makeGuide(overrides: Partial<Guide> = {}): Guide {
  return {
    id: 'guide-uuid-1',
    slug: 'maria-gomez',
    firstName: 'María',
    lastName: 'Gómez',
    // --- PII that MUST NOT leak on the public endpoint ---
    email: 'maria.gomez@example.com',
    documentType: 'CC',
    document: '1234567890',
    phone: '+57 300 111 2222',
    address: 'Cra 5 #12-30, San Rafael',
    user: {
      id: 'user-uuid-9',
      email: 'maria.private@example.com',
      username: 'maria.g',
    },
    // --- safe business fields that MUST be kept ---
    whatsapp: '+57 300 000 0000',
    biography: 'Guía local con 10 años acompañando caminatas.',
    languages: ['es', 'en'],
    facebook: 'maria.gomez.guia',
    instagram: '@maria.guia.sr',
    isAvailable: true,
    isPublic: true,
    categories: [],
    experiences: [],
    reviews: [
      {
        id: 'rev-1',
        rating: 5,
        comment: 'María conoce cada rincón, la caminata fue segura.',
        isPublic: true,
        status: ReviewStatusEnum.APPROVED,
        createdAt: new Date('2026-05-30T11:00:00Z'),
        user: { id: 'reviewer-1', email: 'sofia@example.com', username: 'Sofía L.' },
      },
      {
        id: 'rev-2',
        rating: 1,
        comment: 'Reseña pendiente, no debe exponerse.',
        isPublic: true,
        status: ReviewStatusEnum.PENDING,
        createdAt: new Date('2026-06-01T11:00:00Z'),
        user: { id: 'reviewer-2', email: 'troll@example.com', username: 'Troll' },
      },
      {
        id: 'rev-3',
        rating: 2,
        comment: 'Reseña privada aprobada, no debe exponerse.',
        isPublic: false,
        status: ReviewStatusEnum.APPROVED,
        createdAt: new Date('2026-06-02T11:00:00Z'),
        user: { id: 'reviewer-3', email: 'hidden@example.com', username: 'Hidden' },
      },
    ],
    ...overrides,
  } as unknown as Guide;
}

describe('GuideVectorDto', () => {
  describe('PII exclusion (T-04.1-06 — public projection boundary)', () => {
    it('does NOT expose national ID, email, phone, address or mapped user', () => {
      const dto = new GuideVectorDto({ data: makeGuide() });
      const bag = dto as unknown as Record<string, unknown>;

      expect(bag.document).toBeUndefined();
      expect(bag.documentType).toBeUndefined();
      expect(bag.email).toBeUndefined();
      expect(bag.phone).toBeUndefined();
      expect(bag.address).toBeUndefined();
      expect(bag.user).toBeUndefined();
    });

    it('keeps safe business fields (name, biography, languages, social, whatsapp)', () => {
      const dto = new GuideVectorDto({ data: makeGuide() });

      expect(dto.firstName).toBe('María');
      expect(dto.lastName).toBe('Gómez');
      expect(dto.biography).toBe('Guía local con 10 años acompañando caminatas.');
      expect(dto.languages).toEqual(['es', 'en']);
      expect(dto.instagram).toBe('@maria.guia.sr');
      expect(dto.facebook).toBe('maria.gomez.guia');
      expect(dto.whatsapp).toBe('+57 300 000 0000');
    });
  });

  describe('reviews safe projection (T-04.1-07)', () => {
    it('projects ONLY approved+public reviews to a safe shape', () => {
      const dto = new GuideVectorDto({ data: makeGuide() });

      expect(dto.reviews).toHaveLength(1);
      const [review] = dto.reviews;
      expect(review).toEqual({
        rating: 5,
        comment: 'María conoce cada rincón, la caminata fue segura.',
        authorDisplayName: 'Sofía L.',
        createdAt: new Date('2026-05-30T11:00:00Z'),
      });
    });

    it('never leaks reviewer identity inside a review element', () => {
      const dto = new GuideVectorDto({ data: makeGuide() });
      const review = dto.reviews[0] as unknown as Record<string, unknown>;

      expect(review.user).toBeUndefined();
      expect(review.email).toBeUndefined();
      expect(review.id).toBeUndefined();
      expect(review.status).toBeUndefined();
      expect(review.isPublic).toBeUndefined();
    });

    it('falls back to "Anónimo" when the reviewer has no username', () => {
      const guide = makeGuide({
        reviews: [
          {
            id: 'rev-x',
            rating: 4,
            comment: 'Buena experiencia.',
            isPublic: true,
            status: ReviewStatusEnum.APPROVED,
            createdAt: new Date('2026-05-30T11:00:00Z'),
            user: undefined,
          },
        ] as any,
      });
      const dto = new GuideVectorDto({ data: guide });

      expect(dto.reviews).toHaveLength(1);
      expect(dto.reviews[0].authorDisplayName).toBe('Anónimo');
    });

    it('returns an empty array when there are no reviews', () => {
      const dto = new GuideVectorDto({ data: makeGuide({ reviews: undefined }) });
      expect(dto.reviews).toEqual([]);
    });
  });
});
