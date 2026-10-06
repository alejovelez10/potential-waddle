import type { Restaurant } from '../entities';
import { TownDto } from 'src/modules/towns/dto';
import { PlaceDto } from 'src/modules/places/dto';
import { CategoryDto, FacilityDto } from 'src/modules/core/dto';

export class RestaurantIndexDto {
  id: string;

  name: string;

  slug: string;

  description?: string;

  rating: number;

  reviewCount: number;

  points: number;

  spokenLanguages: string[];

  address?: string;

  phoneNumbers?: string[];

  whatsappNumbers: string[];

  openingHours: string[];

  email?: string;

  website?: string;

  menuUrl?: string;

  priceRanges?: { label: string; priceFrom: number; featured?: boolean }[];

  instagram?: string;

  facebook?: string;

  lowestPrice?: number;

  highestPrice?: number;

  longitude: number;

  latitude: number;

  urbanCenterDistance: number;

  googleMapsUrl?: string;

  howToGetThere?: string;

  townZone?: string;

  town?: TownDto;

  images: string[];

  place?: PlaceDto;

  categories?: CategoryDto[];

  facilities?: FacilityDto[];

  isPublic: boolean;

  forcedPublic: boolean;

  userId?: string;

  /**
   * Admin-only: true when the restaurant owner has accepted the active restaurant T&C document.
   * Undefined on public/non-admin endpoints.
   */
  ownerHasAcceptedTerms?: boolean;

  /** Admin-only: overall completion percentage (0-100). Same value the owner sees. */
  completionPercentage?: number;

  /** Admin-only: info-section completion percentage (0-100). */
  infoPercentage?: number;

  /** Admin-only: current workflow status of the restaurant. */
  status?: 'draft' | 'pending_review' | 'published' | 'rejected';

  /** Admin-only: reason provided when the restaurant was rejected. Null when not rejected. */
  rejectionReason?: string | null;

  paymentMethods?: string[];

  googleMapsRating?: number;

  googleMapsReviewsCount?: number;

  showGoogleMapsReviews?: boolean;

  showBinntuReviews?: boolean;

  hasPromotions?: boolean;

  latestPromotionValue?: number;

  userReview?: string;

  /** Premium business (active subscription) — freemium benefit flag. */
  isPremium?: boolean;

  /** Verified by Binntu (documents reviewed) — independent from Premium. */
  isVerified?: boolean;

  constructor({ data, userReview }: { data?: Restaurant | null; userReview?: string }) {
    if (!data) return;

    this.id = data.id;
    this.userReview = userReview;
    this.name = data.name;
    this.slug = data.slug;
    this.description = data.description ?? undefined;
    this.rating = data.rating;
    this.reviewCount = data.reviewCount;
    this.points = data.points;
    this.spokenLanguages = data.spokenLanguages ?? [];
    this.address = data.address ?? undefined;
    this.phoneNumbers = data.phoneNumbers ?? [];
    this.whatsappNumbers = data.whatsappNumbers ?? [];
    this.openingHours = data.openingHours ?? [];
    this.email = data.email ?? undefined;
    this.website = data.website ?? undefined;
    this.menuUrl = data.menuUrl ?? undefined;
    this.priceRanges = data.priceRanges ?? undefined;
    this.instagram = data.instagram ?? undefined;
    this.facebook = data.facebook ?? undefined;
    this.lowestPrice = data.lowestPrice ?? undefined;
    this.highestPrice = data.higherPrice ?? undefined;
    this.longitude = data.location.coordinates[0] ?? 0;
    this.latitude = data.location.coordinates[1] ?? 0;
    this.images = data.images?.map(i => i.imageResource.url).slice(0, 4) || [];
    this.urbanCenterDistance = data.urbanCenterDistance ?? 0;
    this.googleMapsUrl = data.googleMapsUrl ?? undefined;
    this.howToGetThere = data.howToGetThere ?? undefined;
    this.townZone = data.townZone ?? undefined;
    this.town = data.town ? new TownDto(data.town) : undefined;
    this.place = data.place ? new PlaceDto(data.place) : undefined;
    this.categories = data.categories ? data.categories.map(c => new CategoryDto(c)) : [];
    this.facilities = data.facilities ? data.facilities.map(f => new FacilityDto(f)) : [];
    this.isPublic = data.isPublic;
    this.forcedPublic = data.forcedPublic;
    this.userId = data.user?.id ?? undefined;
    this.paymentMethods = data.paymentMethods ?? [];
    this.googleMapsRating = data.googleMapsRating ?? undefined;
    this.googleMapsReviewsCount = data.googleMapsReviewsCount ?? undefined;
    this.showGoogleMapsReviews = data.showGoogleMapsReviews ?? undefined;
    this.showBinntuReviews = data.showBinntuReviews ?? undefined;
    this.status = data.status;
    this.rejectionReason = data.rejectionReason ?? null;
  }
}
