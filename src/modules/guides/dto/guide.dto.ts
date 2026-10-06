import { CategoryDto } from 'src/modules/core/dto';
import { TownDto } from 'src/modules/towns/dto';
import { Guide } from '../entities/guide.entity';
import { UserDto } from 'src/modules/users/dto/user.dto';
import { ApiProperty } from '@nestjs/swagger';
import { GuideExperienceDto } from './guide-experience.dto';
import type { GuideTermsStatusState, GuideDocsStatusState } from '../utils/compute-guide-completion';

// Owner-scoped sub-DTOs surfacing the 3-indicator completion model (mirror of RestaurantDto).

export class GuideTermsStatusDto {
  @ApiProperty({ enum: ['no_aplica', 'aceptados', 'pendientes'] })
  state: GuideTermsStatusState;

  @ApiProperty({ type: String, nullable: true, required: false })
  activeTermsId?: string | null;
}

export class GuideDocsStatusDto {
  @ApiProperty({ enum: ['no_requeridos', 'opcionales', 'incompletos', 'completos'] })
  state: GuideDocsStatusState;

  @ApiProperty({ example: 2 })
  uploaded: number;

  @ApiProperty({ example: 3 })
  required: number;

  @ApiProperty({ type: [String] })
  missing: string[];
}

export class GuideDto {
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
    example: 'john.doe@example.com',
    description: 'Email address of the guide',
  })
  email: string;

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
    example: 'DNI',
    description: 'Type of identification document',
  })
  documentType: string;

  @ApiProperty({
    example: '12345678',
    description: 'Identification document number',
  })
  document: string;

  @ApiProperty({
    example: '+51987654321',
    description: 'Contact phone number',
  })
  phone: string;

  @ApiProperty({
    example: '+51987654321',
    description: 'WhatsApp contact number',
    required: false,
  })
  whatsapp?: string;

  @ApiProperty({
    example: 'Av. Example 123',
    description: 'Physical address of the guide',
  })
  address: string;

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
    description: 'Creation timestamp',
  })
  createdAt?: Date;

  @ApiProperty({
    description: 'Last update timestamp',
  })
  updatedAt?: Date;

  @ApiProperty({
    example: 4.5,
    description: 'Average rating of the guide',
  })
  rating?: number;

  @ApiProperty({
    example: 10,
    description: 'Number of reviews',
  })
  reviewCount?: number;

  @ApiProperty({
    example: true,
    description: 'Whether to show Binntu reviews',
  })
  showBinntuReviews?: boolean;

  // Relationships
  towns?: TownDto[];
  user?: UserDto;
  categories?: CategoryDto[];
  experiences?: GuideExperienceDto[];
  isPublic?: boolean;
  forcedPublic?: boolean;
  userReview?: string;

  /**
   * Admin-only: true when the guide owner has accepted the active guide T&C document.
   * Undefined on public/non-admin endpoints.
   */
  @ApiProperty({
    example: true,
    description:
      'Admin-only: true when the guide owner has accepted the active guide T&C document. Undefined on public/non-admin endpoints.',
    readOnly: true,
    required: false,
  })
  ownerHasAcceptedTerms?: boolean;

  // * ----------------------------------------------------------------------------------------------------------------
  // * OWNER-SCOPED FIELDS (only populated when the requester is the owner — see applyOwnerEnrichment)
  // * ----------------------------------------------------------------------------------------------------------------
  @ApiProperty({ required: false, enum: ['draft', 'pending_review', 'published', 'rejected'] })
  status?: 'draft' | 'pending_review' | 'published' | 'rejected';

  @ApiProperty({ required: false, type: Number })
  completionPercentage?: number;

  @ApiProperty({ required: false, type: [String] })
  missingFields?: string[];

  @ApiProperty({ required: false, type: Date, nullable: true })
  submittedAt?: Date | null;

  @ApiProperty({ required: false, type: String, nullable: true })
  rejectionReason?: string | null;

  @ApiProperty({ required: false, type: Number })
  infoPercentage?: number;

  @ApiProperty({ required: false, type: [String] })
  infoMissingFields?: string[];

  @ApiProperty({ required: false, type: Boolean })
  infoCriticalSatisfied?: boolean;

  @ApiProperty({ required: false, type: GuideTermsStatusDto })
  termsStatus?: GuideTermsStatusDto;

  @ApiProperty({ required: false, type: GuideDocsStatusDto })
  docsStatus?: GuideDocsStatusDto;

  @ApiProperty({ required: false, type: Boolean })
  readyToSubmit?: boolean;

  @ApiProperty({ required: false, type: [String] })
  skippedOptionalFields?: string[];

  @ApiProperty({ example: false, description: 'Premium guide (active subscription)', required: false })
  isPremium?: boolean;

  @ApiProperty({
    example: false,
    description: 'Verified by Binntu (documents reviewed) — independent from Premium',
    required: false,
  })
  isVerified?: boolean;

  constructor({ data, userReview }: { data: Guide; userReview?: string }) {
    if (!data) return;

    this.id = data.id;
    this.slug = data.slug;
    this.email = data.email;
    this.firstName = data.firstName;
    this.lastName = data.lastName;
    this.documentType = data.documentType;
    this.document = data.document;
    this.phone = data.phone;
    this.whatsapp = data.whatsapp;
    this.address = data.address;
    this.biography = data.biography;
    this.facebook = data.facebook;
    this.instagram = data.instagram;
    this.youtube = data.youtube;
    this.tiktok = data.tiktok;
    this.isAvailable = data.isAvailable;
    this.languages = data.languages;
    this.createdAt = data.createdAt;
    this.updatedAt = data.updatedAt;
    this.images = data.images?.map(image => image.imageResource?.url);
    // Map relationships
    this.user = data.user ? new UserDto(data.user) : undefined;
    this.categories = data.categories?.map(category => new CategoryDto(category));
    this.towns = data.towns?.map(town => new TownDto(town));
    this.experiences = data.experiences?.map(experience => new GuideExperienceDto({ data: experience })) || [];
    this.isPublic = data.isPublic;
    this.forcedPublic = data.forcedPublic;
    this.rating = data.rating ?? 0;
    this.reviewCount = data.reviewCount ?? 0;
    this.showBinntuReviews = data.showBinntuReviews ?? undefined;
    this.userReview = userReview;
    this.skippedOptionalFields = data.skippedOptionalFields ?? [];
    // status SIEMPRE se proyecta para que la admin list pueda renderizar el badge
    // de Validación. completionPercentage / 3-indicator fields siguen siendo
    // owner-only — se populan vía applyOwnerEnrichment cuando el caller es owner.
    this.status = data.status;
    this.rejectionReason = data.rejectionReason ?? null;
  }
}
