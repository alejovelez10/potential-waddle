import { AppIconDto, CategoryDto, FacilityDto } from 'src/modules/core/dto';
import { Experience } from '../entities';
import { TownDto } from 'src/modules/towns/dto';
import { ExperienceGuide } from '../interfaces';
import { GuideDto } from 'src/modules/guides/dto/guide.dto';
import { ReviewStatusEnum } from 'src/modules/reviews/enums';

type SafeReview = { rating: number; comment: string | null; authorDisplayName: string; createdAt: Date };

export class ExperienceVectorDto {
  id: string;

  title: string;

  slug: string;

  description: string;

  difficultyLevel: string;

  price: number;

  priceLabel: string;

  additionalPrices: { price: number; label: string }[];

  travelTime: number;

  totalDistance: number;

  rating: number;

  points: number;

  reviews: SafeReview[];

  // Flattened departure/arrival (Point → lat/long) + reference descriptions.
  departureLatitude?: number;

  departureLongitude?: number;

  departureDescription?: string;

  arrivalLatitude?: number;

  arrivalLongitude?: number;

  arrivalDescription?: string;

  minAge?: number;

  maxAge?: number;

  minParticipants?: number;

  maxParticipants?: number;

  recommendations?: string;

  howToDress?: string;

  restrictions?: string;

  categories?: CategoryDto[];

  facilities?: FacilityDto[];

  town?: TownDto;

  icon?: AppIconDto;

  guides: ExperienceGuide[];

  guide?: GuideDto;

  paymentMethods?: string[];

  isPublic: boolean;
  constructor({ data }: { data: Experience }) {
    if (!data) return;

    this.id = data.id;
    this.title = data.title;
    this.slug = data.slug;
    this.description = data.description;
    this.difficultyLevel = data.difficultyLevel;
    this.price = data.price;
    this.priceLabel = data.priceLabel || 'Persona';
    this.additionalPrices = data.additionalPrices || [];
    this.guide = data.guide ? new GuideDto({ data: data.guide }) : undefined;
    this.travelTime = data.travelTime || 0;
    this.totalDistance = data.totalDistance || 0;
    this.rating = data.rating;
    this.points = data.points;
    // Safe review projection: approved + public only, reviewer reduced to a display name.
    this.reviews = (data.reviews ?? [])
      .filter(r => r.isPublic && r.status === ReviewStatusEnum.APPROVED)
      .map(r => ({
        rating: r.rating,
        comment: r.comment,
        authorDisplayName: r.user?.username ?? 'Anónimo',
        createdAt: r.createdAt,
      }));
    // Flatten departure/arrival Points (coordinates: [longitude, latitude]).
    this.departureLongitude = data.departureLocation?.coordinates?.[0] ?? undefined;
    this.departureLatitude = data.departureLocation?.coordinates?.[1] ?? undefined;
    this.departureDescription = data.departureDescription ?? undefined;
    this.arrivalLongitude = data.arrivalLocation?.coordinates?.[0] ?? undefined;
    this.arrivalLatitude = data.arrivalLocation?.coordinates?.[1] ?? undefined;
    this.arrivalDescription = data.arrivalDescription ?? undefined;
    this.minAge = data.minAge || undefined;
    this.maxAge = data.maxAge || undefined;
    this.minParticipants = data.minParticipants || undefined;
    this.maxParticipants = data.maxParticipants || undefined;
    this.recommendations = data.recommendations || undefined;
    this.howToDress = data.howToDress || undefined;
    this.restrictions = data.restrictions || undefined;
    this.categories = data.categories?.map(category => new CategoryDto(category));
    this.facilities = data.facilities?.map(facility => new FacilityDto(facility));
    this.guides = data.guides || [];

    this.town = new TownDto(data.town);
    this.isPublic = data.isPublic;
    this.paymentMethods = data.paymentMethods || [];
  }
}
