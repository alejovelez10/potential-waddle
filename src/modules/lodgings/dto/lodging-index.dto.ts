import { ApiProperty } from '@nestjs/swagger';

import { Lodging } from '../entities';
import { CategoryDto } from 'src/modules/core/dto';
import { TownDto } from 'src/modules/towns/dto';
import { UserDto } from 'src/modules/users/dto/user.dto';

export class LodgingIndexDto {
  @ApiProperty({
    example: '624013aa-9555-4a69-bf08-30cf990c56dd',
    description: 'The UUID of the place',
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
    example: 4,
    description: 'The number of rooms of the lodging',
    readOnly: true,
    required: false,
  })
  rooms: number;

  @ApiProperty({
    example: 10,
    description: 'The capacity of the lodging (number of guests)',
    readOnly: true,
    required: false,
  })
  capacity?: number;

  @ApiProperty({
    description: 'Minimum price of the lodging',
    readOnly: true,
    required: false,
    example: 10_000,
  })
  lowestPrice?: number;

  @ApiProperty({
    description: 'Maximum price of the lodging',
    readOnly: true,
    required: false,
    example: 100_000,
  })
  highestPrice?: number;

  @ApiProperty({
    description: 'Unit shown after the price (e.g. "noche", "persona", "estadía")',
    readOnly: true,
    required: false,
    example: 'noche',
  })
  priceUnit: string;

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
    example: 'uuid of the user',
    description: 'The UUID of the user',
    readOnly: true,
    required: false,
  })
  user?: UserDto;

  @ApiProperty({
    example: true,
    description: 'Indicates if the lodging is public',
    readOnly: true,
    required: false,
  })
  isPublic: boolean;

  forcedPublic: boolean;

  @ApiProperty({
    example: true,
    description:
      'Admin-only: true when the lodging owner has accepted the active lodging T&C document. Undefined on public/non-admin endpoints.',
    readOnly: true,
    required: false,
  })
  ownerHasAcceptedTerms?: boolean;

  @ApiProperty({
    example: '2026-05-13T22:00:00.000Z',
    description: 'Admin-only: timestamp when the lodging was last submitted for review. Null if never submitted.',
    readOnly: true,
    required: false,
    nullable: true,
  })
  submittedAt?: Date | null;

  @ApiProperty({
    example: 'pending_review',
    description: 'Admin-only: current workflow status of the lodging.',
    readOnly: true,
    required: false,
    enum: ['draft', 'pending_review', 'published', 'rejected'],
  })
  status?: string;

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
    example: 123.456,
    description: 'Latitude of the lodging',
    required: false,
  })
  latitude: number;

  @ApiProperty({
    example: 123.456,
    description: 'Longitude of the lodging',
    required: false,
  })
  longitude: number;

  @ApiProperty({
    example: '123456789',
    description: 'Whatsapp number of the lodging',
    required: false,
  })
  whatsappNumbers: string[];

  googleMapsUrl?: string;

  @ApiProperty({
    example: 'contacto@hospedaje.com',
    description: 'Owner contact email. Sent on list endpoints so the dashboard FE skip-penalty can read it.',
    required: false,
    nullable: true,
  })
  email?: string | null;

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

  @ApiProperty({
    example: true,
    description: 'Indicates if the lodging has active promotions',
    required: false,
  })
  hasPromotions?: boolean;

  @ApiProperty({
    example: 25,
    description: 'Percentage of the latest active promotion',
    required: false,
  })
  latestPromotionValue?: number;

  @ApiProperty({ example: false, description: 'Premium business (active subscription)', required: false })
  isPremium?: boolean;

  @ApiProperty({
    example: false,
    description: 'Verified by Binntu (documents reviewed) — independent from Premium',
    required: false,
  })
  isVerified?: boolean;

  constructor(lodging?: Lodging, userReview?: string) {
    if (!lodging) return;
    this.id = lodging.id;
    this.town = new TownDto(lodging.town);
    this.name = lodging.name;
    this.slug = lodging.slug;
    this.categories = lodging.categories.map(category => new CategoryDto(category));
    this.description = lodging.description || '';
    this.reviewsCount = lodging.reviewCount || 0;
    this.points = lodging.points;
    this.rooms = lodging.roomCount;
    this.capacity = lodging.capacity || undefined;
    this.images = lodging.images
      .sort((a, b) => a.order - b.order)
      .map(image => image.imageResource.url)
      .slice(0, 4);

    this.rating = lodging.rating;
    this.googleMapsUrl = lodging.googleMapsUrl || undefined;
    this.email = lodging.email ?? null;
    this.googleMapsRating = lodging.googleMapsRating || undefined;
    this.googleMapsReviewsCount = lodging.googleMapsReviewsCount || undefined;
    this.showGoogleMapsReviews = lodging.showGoogleMapsReviews;
    this.showBinntuReviews = lodging.showBinntuReviews;
    this.user = new UserDto(lodging.user);
    this.lowestPrice = lodging.lowestPrice || undefined;
    this.highestPrice = lodging.highestPrice || undefined;
    this.priceUnit = lodging.priceUnit || 'noche';
    this.userReview = userReview;
    this.openingHours = lodging.openingHours || undefined;
    this.urbanCenterDistance = lodging.urbanCenterDistance || 0;
    this.isPublic = lodging.isPublic;
    this.forcedPublic = lodging.forcedPublic;
    this.longitude = lodging.location?.coordinates[0] || 0;
    this.latitude = lodging.location?.coordinates[1] || 0;
    this.whatsappNumbers = lodging.whatsappNumbers || [];
    // Admin-only fields — always projected so the admin list row carries them
    this.submittedAt = lodging.submittedAt ?? null;
    this.status = lodging.status;
  }
}
