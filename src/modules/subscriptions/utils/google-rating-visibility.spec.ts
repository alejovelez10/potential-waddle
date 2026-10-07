import { hideGoogleRatingUnlessPremium } from './google-rating-visibility';

describe('hideGoogleRatingUnlessPremium', () => {
  const rated = () => ({ googleMapsRating: 4.6, googleMapsReviewsCount: 120, showGoogleMapsReviews: true });

  it('keeps the Google rating of Premium businesses', () => {
    expect(hideGoogleRatingUnlessPremium(rated(), true)).toEqual(rated());
  });

  it('hides the Google rating of free businesses', () => {
    expect(hideGoogleRatingUnlessPremium(rated(), false)).toEqual({
      googleMapsRating: undefined,
      googleMapsReviewsCount: undefined,
      showGoogleMapsReviews: false,
    });
  });

  it('does not add the visibility flag to DTOs that lack it', () => {
    const dto = hideGoogleRatingUnlessPremium({ googleMapsRating: 4.1 } as { googleMapsRating?: number }, false);
    expect(dto).not.toHaveProperty('showGoogleMapsReviews');
    expect(dto.googleMapsRating).toBeUndefined();
  });
});
