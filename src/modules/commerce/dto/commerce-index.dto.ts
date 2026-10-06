import { ApiProperty } from '@nestjs/swagger';

import { Commerce } from '../entities';
import { CategoryDto } from 'src/modules/core/dto';
import { TownDto } from 'src/modules/towns/dto';

export class CommerceIndexDto {
  @ApiProperty({
    example: '624013aa-9555-4a69-bf08-30cf990c56dd',
    description: 'The UUID of the commerce',
    readOnly: true,
  })
  id: string;

  @ApiProperty({
    type: TownDto,
    readOnly: true,
    required: false,
  })
  town?: TownDto;

  @ApiProperty({
    example: 'San Rafael',
    description: 'The name of the lodging',
  })
  name: string;

  @ApiProperty({
    example: 'san-rafael',
    description: 'The slug of the lodging',
  })
  slug: string;

  @ApiProperty({
    description: 'List of categories of the lodging',
    readOnly: true,
    required: false,
    type: CategoryDto,
    isArray: true,
  })
  categories: CategoryDto[];

  @ApiProperty({
    example: ['https://image.jpg'],
    isArray: true,
    description: 'The image of the lodging',
    readOnly: true,
    required: false,
    type: String,
  })
  images: string[];

  @ApiProperty({
    example: 'This ',
    description: 'The description of the lodging',
  })
  description: string;

  @ApiProperty({
    example: 13,
    description: 'The review counts of the lodging',
    readOnly: true,
    required: false,
  })
  reviewsCount: number;

  @ApiProperty({
    example: 100,
    description: 'Score awarded for reaching the lodging, on a scale from 1 to 100',
    readOnly: true,
    required: false,
  })
  points: number;

  @ApiProperty({
    example: 4.5,
    description: 'Rating of the lodging, on a scale from 1 to 5',
    readOnly: true,
    required: false,
  })
  rating: number;

  @ApiProperty({
    description: 'Indicates if the current user has review',
    example: 'uuid of the review',
    readOnly: true,
    required: false,
  })
  userReview?: string;

  @ApiProperty({
    example: '08:00-18:00',
    description: 'The opening hours of the lodging',
    readOnly: true,
    required: false,
  })
  openingHours?: string[];

  @ApiProperty({
    example: 1340,
    description: 'The distance from the urban center of the town to the place',
    readOnly: true,
    required: false,
  })
  urbanCenterDistance: number;

  @ApiProperty({
    example: ['123456789'],
    description: 'Phone numbers of the commerce',
    isArray: true,
    required: false,
    type: String,
  })
  phoneNumbers: string[];

  @ApiProperty({
    example: 'contact@commerce.com',
    description: 'Email of the commerce',
    required: false,
  })
  email: string | null;

  @ApiProperty({
    example: 'https://www.commerce.com',
    description: 'Website of the commerce',
    required: false,
  })
  website: string | null;

  @ApiProperty({
    example: 'https://facebook.com/commerce',
    description: 'Facebook profile of the commerce',
    required: false,
  })
  facebook: string | null;

  @ApiProperty({
    example: 'https://instagram.com/commerce',
    description: 'Instagram profile of the commerce',
    required: false,
  })
  instagram: string | null;

  @ApiProperty({
    example: ['123456789'],
    description: 'WhatsApp numbers of the commerce',
    isArray: true,
    required: false,
    type: String,
  })
  whatsappNumbers: string[];

  @ApiProperty({
    example: 'Av. Principal 123',
    description: 'Physical address of the commerce',
    required: false,
  })
  address: string | null;

  @ApiProperty({
    example: 'https://goo.gl/maps/example',
    description: 'Google Maps URL of the commerce',
    required: false,
  })
  googleMapsUrl: string | null;

  @ApiProperty({
    example: '624013aa-9555-4a69-bf08-30cf990c56dd',
    description: 'The UUID of the user',
    readOnly: true,
    required: false,
  })
  userId: string;

  @ApiProperty({
    example: true,
    description: 'Indicates if the commerce is public',
    readOnly: true,
    required: false,
  })
  isPublic: boolean;

  forcedPublic: boolean;

  @ApiProperty({
    example: true,
    description:
      'Admin-only: true when the commerce owner has accepted the active commerce T&C document. Undefined on public/non-admin endpoints.',
    readOnly: true,
    required: false,
  })
  ownerHasAcceptedTerms?: boolean;

  @ApiProperty({
    example: 100,
    description: 'Admin-only: overall completion percentage (0-100). Same value the owner sees.',
    readOnly: true,
    required: false,
  })
  completionPercentage?: number;

  @ApiProperty({
    example: 100,
    description: 'Admin-only: info-section completion percentage (0-100).',
    readOnly: true,
    required: false,
  })
  infoPercentage?: number;

  @ApiProperty({
    example: 'pending_review',
    description: 'Admin-only: current workflow status of the commerce.',
    readOnly: true,
    required: false,
    enum: ['draft', 'pending_review', 'published', 'rejected'],
  })
  status?: 'draft' | 'pending_review' | 'published' | 'rejected';

  @ApiProperty({
    example: 'Missing required documentation',
    description: 'Admin-only: reason provided when the commerce was rejected. Null when not rejected.',
    readOnly: true,
    required: false,
    nullable: true,
  })
  rejectionReason?: string | null;

  @ApiProperty({
    example: 123.456,
    description: 'Latitude of the commerce',
    required: false,
  })
  latitude: number;

  @ApiProperty({
    example: 123.456,
    description: 'Longitude of the commerce',
    required: false,
  })
  longitude: number;

  @ApiProperty({
    example: 4.7,
    description: 'Google Maps rating of the lodging',
    required: false,
  })
  googleMapsRating?: number;

  @ApiProperty({
    example: 253,
    description: 'Number of reviews on Google Maps',
    required: false,
  })
  googleMapsReviewsCount?: number;

  @ApiProperty({
    example: true,
    description: 'Whether to show Google Maps reviews',
    required: false,
  })
  showGoogleMapsReviews?: boolean;

  @ApiProperty({
    example: true,
    description: 'Whether to show Binntu reviews',
    required: false,
  })
  showBinntuReviews?: boolean;

  @ApiProperty({ example: false, description: 'Premium business (active subscription)', required: false })
  isPremium?: boolean;

  @ApiProperty({
    example: false,
    description: 'Verified by Binntu (documents reviewed) — independent from Premium',
    required: false,
  })
  isVerified?: boolean;

  constructor(commerce?: Commerce, userReview?: string) {
    if (!commerce) return;
    this.id = commerce.id;
    this.town = new TownDto(commerce.town);
    this.name = commerce.name;
    this.slug = commerce.slug;
    this.categories = commerce.categories.map(category => new CategoryDto(category));
    this.description = commerce.description || '';
    this.reviewsCount = commerce.reviewCount ?? 0;
    this.points = commerce.points;
    this.images = commerce.images.map(image => image.imageResource.url);
    this.rating = commerce.rating;
    this.userReview = userReview;
    this.openingHours = commerce.openingHours || undefined;
    this.urbanCenterDistance = commerce.urbanCenterDistance || 0;
    this.phoneNumbers = commerce.phoneNumbers || [];
    this.email = commerce.email;
    this.website = commerce.website;
    this.facebook = commerce.facebook;
    this.instagram = commerce.instagram;
    this.whatsappNumbers = commerce.whatsappNumbers || [];
    this.address = commerce.address;
    this.googleMapsUrl = commerce.googleMapsUrl;
    this.userId = commerce.user?.id || '';
    this.isPublic = commerce.isPublic;
    this.forcedPublic = commerce.forcedPublic;
    this.longitude = commerce.location?.coordinates[0] || 0;
    this.latitude = commerce.location?.coordinates[1] || 0;
    this.googleMapsRating = commerce.googleMapsRating || undefined;
    this.googleMapsReviewsCount = commerce.googleMapsReviewsCount || undefined;
    this.showGoogleMapsReviews = commerce.showGoogleMapsReviews || undefined;
    this.showBinntuReviews = commerce.showBinntuReviews ?? undefined;
    this.status = commerce.status;
    this.rejectionReason = commerce.rejectionReason ?? null;
  }
}
