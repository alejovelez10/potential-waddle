import { ApiProperty } from '@nestjs/swagger';
import { FacilityDto, CategoryDto } from 'src/modules/core/dto';
import { Lodging } from '../entities';
import { PlaceDto } from 'src/modules/places/dto';
import { LodgingRoomTypeDto } from './lodging-room-type.dto';
import { LodgingImageDto } from './lodging-image.dto';
import { TownDto } from 'src/modules/towns/dto';
import { UserDto } from 'src/modules/users/dto/user.dto';
import type { LodgingTermsStatusState, LodgingDocsStatusState } from '../utils/compute-lodging-completion';

// Owner-scoped sub-DTOs surfacing the 3-indicator completion model. Each one is
// independent: info is gradual %, terms is binary, docs is a checklist.

export class LodgingTermsStatusDto {
  @ApiProperty({ enum: ['no_aplica', 'aceptados', 'pendientes'] })
  state: LodgingTermsStatusState;

  @ApiProperty({
    type: String,
    nullable: true,
    required: false,
    description: 'ID of the active lodging T&C version. Used to redirect to accept-terms when pendientes.',
  })
  activeTermsId?: string | null;
}

export class LodgingDocsStatusDto {
  @ApiProperty({ enum: ['no_requeridos', 'opcionales', 'incompletos', 'completos'] })
  state: LodgingDocsStatusState;

  @ApiProperty({ example: 2, description: 'Required docs uploaded and valid' })
  uploaded: number;

  @ApiProperty({ example: 3, description: 'Total required docs' })
  required: number;

  @ApiProperty({ type: [String], description: 'Names of required docs still missing or expired' })
  missing: string[];
}

export class LodgingFullDto {
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
    description: 'List of images of the lodging with full details',
    readOnly: true,
    required: false,
    type: LodgingImageDto,
    isArray: true,
  })
  images: LodgingImageDto[];

  @ApiProperty({
    example: 'This is a description',
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

  @ApiProperty({
    description: 'List of facilities of the lodging',
    readOnly: true,
    required: false,
    type: FacilityDto,
    isArray: true,
  })
  facilities: FacilityDto[];

  @ApiProperty({
    example: ['WiFi', 'Parking', 'Pool'],
    description: 'List of amenities of the lodging',
    readOnly: true,
    required: false,
    type: 'string',
    isArray: true,
  })
  amenities: string[];

  @ApiProperty({
    example: ['Single', 'Double', 'Triple'],
    description: 'List of room types of the lodging (legacy field)',
    readOnly: true,
    required: false,
    type: 'string',
    isArray: true,
  })
  roomTypes: string[];

  @ApiProperty({
    description: 'List of detailed room types of the lodging',
    readOnly: true,
    required: false,
    type: LodgingRoomTypeDto,
    isArray: true,
  })
  lodgingRoomTypes: LodgingRoomTypeDto[];

  @ApiProperty({
    example: '123 Main St',
    description: 'The address of the lodging',
    required: false,
  })
  address?: string;

  @ApiProperty({
    example: ['123456789', '987654321'],
    description: 'List of phones of the lodging',
    required: false,
  })
  phoneNumbers?: string[];

  @ApiProperty({
    example: 'example@example.com',
    description: 'The email of the lodging',
    required: false,
  })
  email?: string;

  @ApiProperty({
    example: 'https://example.com',
    description: 'The website of the lodging',
    required: false,
  })
  website?: string;

  @ApiProperty({
    example: 'https://facebook.com/example',
    description: 'The Facebook URL of the lodging',
    required: false,
  })
  facebook?: string;

  @ApiProperty({
    example: 'https://instagram.com/example',
    description: 'The Instagram URL of the lodging',
    required: false,
  })
  instagram?: string;

  @ApiProperty({
    example: ['English', 'Spanish'],
    description: 'List of languages spoken in the lodging',
    required: false,
  })
  languages?: string[];

  @ApiProperty({
    example: 'https://goo.gl/maps/123',
    description: 'The Google Maps URL of the place',
    required: false,
  })
  googleMapsUrl?: string;

  @ApiProperty({
    example: 'How to get there',
    description: 'The way to get to the place',
    required: false,
  })
  howToGetThere?: string;

  @ApiProperty({
    example: 'Arrival reference',
    description: 'The arrival reference of the place',
    required: false,
  })
  arrivalReference?: string;

  @ApiProperty({
    example: ['cash', 'card'],
    description: 'Payment methods',
    required: false,
  })
  paymentMethods?: string[];

  @ApiProperty({
    example: 10,
    description: 'Capacity of the lodging',
    required: false,
  })
  capacity?: number;

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
    example: [],
    description: 'List of places associated with the lodging',
    required: false,
    type: PlaceDto,
    isArray: true,
  })
  places?: PlaceDto[];

  // * ----------------------------------------------------------------------------------------------------------------
  // * OWNER-SCOPED FIELDS (only populated when the requester is the owner)
  // * ----------------------------------------------------------------------------------------------------------------
  @ApiProperty({
    required: false,
    enum: ['draft', 'pending_review', 'published', 'rejected'],
    description: 'Current workflow status of the lodging (owner-only)',
  })
  status?: 'draft' | 'pending_review' | 'published' | 'rejected';

  @ApiProperty({
    required: false,
    type: Number,
    description: 'Completion percentage 0-100 (owner-only)',
  })
  completionPercentage?: number;

  @ApiProperty({
    required: false,
    type: [String],
    description: 'Slugs of fields that still need to be filled (owner-only)',
  })
  missingFields?: string[];

  @ApiProperty({
    required: false,
    type: Date,
    nullable: true,
    description: 'Timestamp when the lodging was submitted for review (owner-only)',
  })
  submittedAt?: Date | null;

  @ApiProperty({
    required: false,
    type: String,
    nullable: true,
    description: 'Reason the lodging was rejected, if applicable (owner-only)',
  })
  rejectionReason?: string | null;

  @ApiProperty({
    required: false,
    type: Boolean,
    example: false,
    description: 'Owner-opt-out flag for room types. When true, the Rooms bucket is treated as satisfied.',
  })
  roomsNotApplicable?: boolean;

  @ApiProperty({
    required: false,
    type: [String],
    example: ['facebook', 'instagram'],
    description:
      'Optional-field slugs the owner marked "No tengo". Persisted so the FE skip-penalty + "No aplica" badge survive logout.',
  })
  skippedOptionalFields?: string[];

  // ------------------------------------------------------------------------------------------------
  // 3-indicator completion model (owner-only). `completionPercentage` above is preserved as an
  // alias of `infoPercentage` for backwards-compat — old clients keep reading it.
  // ------------------------------------------------------------------------------------------------
  @ApiProperty({
    required: false,
    type: Number,
    description: 'Info-only completion 0-100 (data fields, not gates). Owner-only.',
  })
  infoPercentage?: number;

  @ApiProperty({
    required: false,
    type: [String],
    description: 'Slugs of info-bucket fields still missing. Owner-only.',
  })
  infoMissingFields?: string[];

  @ApiProperty({
    required: false,
    type: Boolean,
    description: 'All info-bucket critical fields satisfied (whatsapp, price, rooms, photos≥3). Owner-only.',
  })
  infoCriticalSatisfied?: boolean;

  @ApiProperty({
    required: false,
    type: LodgingTermsStatusDto,
    description: 'T&C acceptance status (per-user-globally for lodging T&C). Owner-only.',
  })
  termsStatus?: LodgingTermsStatusDto;

  @ApiProperty({
    required: false,
    type: LodgingDocsStatusDto,
    description: 'Documents checklist status (filtered by town × categories). Owner-only.',
  })
  docsStatus?: LodgingDocsStatusDto;

  @ApiProperty({
    required: false,
    type: Boolean,
    description: 'True iff info ≥80 + critical + terms not-pendientes (docs only gate verification). Owner-only.',
  })
  readyToSubmit?: boolean;

  constructor(lodging?: Lodging, userReview?: string) {
    if (!lodging) return;

    // Basic fields from LodgingIndexDto
    this.id = lodging.id;
    this.town = new TownDto(lodging.town);
    this.name = lodging.name;
    this.slug = lodging.slug;
    this.categories = lodging.categories.map(category => new CategoryDto(category));
    this.description = lodging.description || '';
    this.reviewsCount = lodging.reviewCount || 0;
    this.points = lodging.points;
    this.rooms = lodging.roomCount;
    this.rating = lodging.rating;
    this.googleMapsUrl = lodging.googleMapsUrl || undefined;
    this.googleMapsRating = lodging.googleMapsRating || undefined;
    this.googleMapsReviewsCount = lodging.googleMapsReviewsCount || undefined;
    this.showGoogleMapsReviews = lodging.showGoogleMapsReviews;
    this.showBinntuReviews = lodging.showBinntuReviews;
    this.roomsNotApplicable = lodging.roomsNotApplicable ?? false;
    this.skippedOptionalFields = lodging.skippedOptionalFields ?? [];
    this.user = new UserDto(lodging.user);
    this.lowestPrice = lodging.lowestPrice || undefined;
    this.highestPrice = lodging.highestPrice || undefined;
    this.priceUnit = lodging.priceUnit || 'noche';
    this.userReview = userReview;
    this.openingHours = lodging.openingHours || undefined;
    this.urbanCenterDistance = lodging.urbanCenterDistance || 0;
    this.isPublic = lodging.isPublic;
    this.longitude = lodging.location?.coordinates[0] || 0;
    this.latitude = lodging.location?.coordinates[1] || 0;
    this.whatsappNumbers = lodging.whatsappNumbers || [];

    // Full DTO specific fields
    this.facilities = lodging.facilities?.map(facility => new FacilityDto(facility)) || [];
    this.amenities = lodging.amenities || [];
    this.roomTypes = lodging.roomTypes || [];
    this.lodgingRoomTypes = lodging.lodgingRoomTypes?.map(roomType => new LodgingRoomTypeDto(roomType)) || [];
    this.address = lodging.address || undefined;
    this.phoneNumbers = lodging.phoneNumbers || [];
    this.email = lodging.email || undefined;
    this.website = lodging.website || undefined;
    this.facebook = lodging.facebook || undefined;
    this.instagram = lodging.instagram || undefined;
    this.languages = lodging.spokenLanguages;
    this.howToGetThere = lodging.howToGetThere || undefined;
    this.arrivalReference = lodging.arrivalReference || undefined;
    this.paymentMethods = lodging.paymentMethods || [];
    this.capacity = lodging.capacity || undefined;
    this.images = lodging.images
      .filter(image => image.imageResource != null)
      .sort((a, b) => a.order - b.order)
      .map(image => new LodgingImageDto(image));
    this.places = lodging.places?.map(lodgingPlace => new PlaceDto(lodgingPlace.place)) || [];
  }
}
