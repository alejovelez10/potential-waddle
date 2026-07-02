import { ApiProperty } from '@nestjs/swagger';
import { LodgingIndexDto } from './lodging-index.dto';
import { FacilityDto } from 'src/modules/core/dto';
import { Lodging } from '../entities';
import { ReviewStatusEnum } from 'src/modules/reviews/enums';

type SafeReview = { rating: number; comment: string | null; authorDisplayName: string; createdAt: Date };

type RoomTypeFull = {
  name: string;
  description: string | null;
  price: number;
  maxCapacity: number;
  bedCount: number;
  bedType: string | null;
  roomSize: number | null;
  bathroomType: string | null;
  hasWifi: boolean;
  hasAirConditioning: boolean;
  hasKitchen: boolean;
  hasBalcony: boolean;
  view: string | null;
  amenities: string[];
  images: string[];
};

type NearbyPlace = { placeName?: string; distance: number };

export class LodgingVectorDto extends LodgingIndexDto {
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
    description: 'List of room types of the lodging',
    readOnly: true,
    required: false,
    type: 'string',
    isArray: true,
  })
  roomTypes: string[];

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
    example: 6.2,
    description: 'The longitude of the place',
    readOnly: true,
    required: false,
  })
  longitude: number;

  @ApiProperty({
    example: 6.2,
    description: 'The longitude of the place',
    readOnly: true,
    required: false,
  })
  latitude: number;

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

  // Full structured room types (with flat image URLs), nearby places and safe public reviews.
  lodgingRoomTypes?: RoomTypeFull[];

  nearbyPlaces?: NearbyPlace[];

  reviews?: SafeReview[];

  constructor(lodging?: Lodging, userReview?: string) {
    super(lodging, userReview);

    if (!lodging) return;
    this.facilities = lodging.facilities?.map(facility => new FacilityDto(facility)) || [];
    this.amenities = lodging.amenities || [];
    this.roomTypes = lodging.roomTypes || [];
    this.address = lodging.address || undefined;
    this.phoneNumbers = lodging.phoneNumbers || [];
    this.email = lodging.email || undefined;
    this.website = lodging.website || undefined;
    this.facebook = lodging.facebook || undefined;
    this.instagram = lodging.instagram || undefined;
    this.whatsappNumbers = lodging.whatsappNumbers;
    this.languages = lodging.spokenLanguages;
    this.longitude = lodging.location?.coordinates[0] || 0;
    this.latitude = lodging.location?.coordinates[1] || 0;
    this.googleMapsUrl = lodging.googleMapsUrl || undefined;
    this.howToGetThere = lodging.howToGetThere || undefined;
    this.arrivalReference = lodging.arrivalReference || undefined;
    this.paymentMethods = lodging.paymentMethods || [];
    this.capacity = lodging.capacity || undefined;
    this.googleMapsRating = lodging.googleMapsRating || undefined;
    this.googleMapsReviewsCount = lodging.googleMapsReviewsCount || undefined;
    // Full room types with flat image URL strings (not {imageResource:{url}}).
    this.lodgingRoomTypes = (lodging.lodgingRoomTypes ?? []).map(rt => ({
      name: rt.name,
      description: rt.description,
      price: rt.price,
      maxCapacity: rt.maxCapacity,
      bedCount: rt.bedCount,
      bedType: rt.bedType,
      roomSize: rt.roomSize,
      bathroomType: rt.bathroomType,
      hasWifi: rt.hasWifi,
      hasAirConditioning: rt.hasAirConditioning,
      hasKitchen: rt.hasKitchen,
      hasBalcony: rt.hasBalcony,
      view: rt.view,
      amenities: rt.amenities ?? [],
      images: (rt.images ?? []).map(i => i.imageResource?.url).filter((u): u is string => !!u),
    }));
    this.nearbyPlaces = (lodging.places ?? []).map(lp => ({
      placeName: lp.place?.name,
      distance: lp.distance,
    }));
    // Safe review projection: approved + public only, reviewer reduced to a display name.
    this.reviews = (lodging.reviews ?? [])
      .filter(r => r.isPublic && r.status === ReviewStatusEnum.APPROVED)
      .map(r => ({
        rating: r.rating,
        comment: r.comment,
        authorDisplayName: r.user?.username ?? 'Anónimo',
        createdAt: r.createdAt,
      }));
  }
}
