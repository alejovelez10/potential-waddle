interface GoogleRatingFields {
  googleMapsRating?: number | null;
  googleMapsReviewsCount?: number | null;
  showGoogleMapsReviews?: boolean;
}

/**
 * Freemium (2026-10): Google reviews — including the Google Maps rating shown on profiles and
 * cards — are a Premium benefit. Free businesses never expose the rating publicly (their stored
 * value would be frozen anyway: the Google sync crons only run for Premium businesses).
 *
 * Mutates and returns the DTO so it can wrap a constructor call.
 */
export function hideGoogleRatingUnlessPremium<T extends GoogleRatingFields>(dto: T, isPremium: boolean): T {
  if (isPremium) return dto;
  dto.googleMapsRating = undefined;
  dto.googleMapsReviewsCount = undefined;
  if ('showGoogleMapsReviews' in dto) dto.showGoogleMapsReviews = false;
  return dto;
}
