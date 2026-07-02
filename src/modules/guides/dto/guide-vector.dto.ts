import { CategoryDto } from 'src/modules/core/dto';
import { TownDto } from 'src/modules/towns/dto';
import { Guide } from '../entities/guide.entity';
import { ApiProperty } from '@nestjs/swagger';
import { GuideExperienceDto } from './guide-experience.dto';
import { ReviewStatusEnum } from '../../reviews/enums';

/**
 * Public projection of a Guide for the UNAUTHENTICATED /public/full-info endpoint.
 *
 * SECURITY (T-04.1-06): this DTO deliberately does NOT expose the guide's national
 * ID (document/documentType), email, phone, address, nor the full mapped `user`.
 * The *VectorDto constructor is the only projection boundary between the DB and the
 * open internet, so those fields are dropped here on purpose — do NOT re-add them.
 */
export class GuideVectorDto {
  @ApiProperty({
    example: '123e4567-e89b-12d3-a456-426614174000',
    description: 'Unique identifier of the guide',
  })
  id: string;

  @ApiProperty({
    example: 'john-doe',
    description: 'Slug of the guide',
  })
  slug: string;

  @ApiProperty({
    example: 'John',
    description: 'The first name of the guide',
  })
  firstName: string;

  @ApiProperty({
    example: 'Doe',
    description: 'The last name of the guide',
  })
  lastName: string;

  @ApiProperty({
    example: '+51987654321',
    description: 'WhatsApp contact number (public business channel)',
    required: false,
  })
  whatsapp?: string;

  @ApiProperty({
    example: 'Experienced tour guide with 5 years of experience...',
    description: 'Professional biography of the guide',
    required: false,
  })
  biography?: string;

  @ApiProperty({
    example: ['English', 'Spanish'],
    description: 'Languages spoken by the guide',
    required: false,
  })
  languages?: string[];

  @ApiProperty({
    example: ['Tour Guide', 'Private Guide', 'Group Guide'],
    description: 'Types of guide services offered',
    required: false,
  })
  guideType?: string[];

  @ApiProperty({
    example: 'https://facebook.com/profile',
    description: 'Facebook profile URL',
    required: false,
  })
  facebook?: string;

  @ApiProperty({
    example: 'https://instagram.com/profile',
    description: 'Instagram profile URL',
    required: false,
  })
  instagram?: string;

  @ApiProperty({
    example: 'https://youtube.com/channel',
    description: 'YouTube channel URL',
    required: false,
  })
  youtube?: string;

  @ApiProperty({
    example: 'https://tiktok.com/@profile',
    description: 'TikTok profile URL',
    required: false,
  })
  tiktok?: string;

  @ApiProperty({
    example: 'https://image.jpg',
    isArray: true,
    description: 'The image of the guide',
    readOnly: true,
    required: false,
  })
  images?: string[];

  @ApiProperty({
    example: true,
    description: 'Whether the guide is currently available',
    default: true,
  })
  isAvailable?: boolean;

  @ApiProperty({
    description: 'Public approved reviews (safe projection — no reviewer identity)',
    required: false,
  })
  reviews: { rating: number; comment: string | null; authorDisplayName: string; createdAt: Date }[];

  @ApiProperty({
    description: 'Creation timestamp',
  })
  createdAt?: Date;

  @ApiProperty({
    description: 'Last update timestamp',
  })
  updatedAt?: Date;

  // Relationships
  town?: TownDto;
  towns?: TownDto[];
  categories?: CategoryDto[];
  experiences?: GuideExperienceDto[];
  isPublic?: boolean;

  constructor({ data }: { data: Guide }) {
    if (!data) return;

    this.id = data.id;
    this.slug = data.slug;
    this.firstName = data.firstName;
    this.lastName = data.lastName;
    this.whatsapp = data.whatsapp;
    this.biography = data.biography;
    this.facebook = data.facebook;
    this.instagram = data.instagram;
    this.youtube = data.youtube;
    this.tiktok = data.tiktok;
    this.isAvailable = data.isAvailable;
    this.languages = data.languages;
    // WR-02: these were declared but never assigned, so rafa's guide_type/towns
    // columns were permanently empty. guideType is a string[] passthrough; towns is
    // the same PII-safe TownDto projection used elsewhere (rafa reads towns[].name).
    this.guideType = data.guideType ?? [];
    this.towns = data.towns?.map(town => new TownDto(town)) ?? [];
    // Safe review projection: approved + public only, reviewer reduced to a display name.
    this.reviews = (data.reviews ?? [])
      .filter(r => r.isPublic && r.status === ReviewStatusEnum.APPROVED)
      .map(r => ({
        rating: r.rating,
        comment: r.comment,
        authorDisplayName: r.user?.username ?? 'Anónimo',
        createdAt: r.createdAt,
      }));
    // Map relationships (NOTE: reviewer/guide `user` is intentionally never serialized).
    this.categories = data.categories?.map(category => new CategoryDto(category));
    this.experiences = data.experiences?.map(experience => new GuideExperienceDto({ data: experience })) || [];
    this.isPublic = data.isPublic;
  }
}
