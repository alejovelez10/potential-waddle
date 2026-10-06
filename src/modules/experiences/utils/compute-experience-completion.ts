import { Experience } from '../entities';

// =================================================================================================
// Info completion — mirror of computeLodging/Restaurant/Commerce/GuideInfoCompletion
// =================================================================================================

export interface ExperienceInfoCompletionResult {
  infoPercentage: number;
  infoMissingFields: string[];
  infoCriticalSatisfied: boolean;
}

/**
 * Weighted buckets per Sprint 3 spec:
 *  - Información básica  (20%): title, description>=50, townId
 *  - Itinerario          (20%): departureLocation + arrivalLocation (critical)
 *  - Precios             (10%): price > 0 (critical)
 *  - Métricas            (10%): travelTime, totalDistance, difficultyLevel
 *  - Recomendaciones     (10%): minAge, maxAge, restrictions, howToDress (any 2+)
 *  - Categorías          (10%): categories>=1 (critical)
 *  - Fotos               (20%): images>=3 (critical)
 *
 * Critical: title + description>=50 + departure + arrival + price + categories + images>=3
 */
export function computeExperienceInfoCompletion(experience: Experience): ExperienceInfoCompletionResult {
  const infoMissingFields: string[] = [];
  let totalScore = 0;

  // Bucket 1: Información básica (20)
  const hasTitle = !!(experience.title && experience.title.trim().length > 0);
  const hasDescription = !!(experience.description && experience.description.trim().length >= 50);
  const hasTown = !!experience.town?.id;
  const basicCount = [hasTitle, hasDescription, hasTown].filter(Boolean).length;
  totalScore += (basicCount / 3) * 20;
  if (!hasTitle) infoMissingFields.push('title');
  if (!hasDescription) infoMissingFields.push('description');
  if (!hasTown) infoMissingFields.push('townId');

  // Bucket 2: Itinerario (20) — both critical
  const hasDeparture = !!(experience.departureLocation && experience.departureLocation.coordinates);
  const hasArrival = !!(experience.arrivalLocation && experience.arrivalLocation.coordinates);
  totalScore += (((hasDeparture ? 1 : 0) + (hasArrival ? 1 : 0)) / 2) * 20;
  if (!hasDeparture) infoMissingFields.push('departureLocation');
  if (!hasArrival) infoMissingFields.push('arrivalLocation');

  // Bucket 3: Precios (10) — critical
  const hasPrice = !!(experience.price !== null && experience.price !== undefined && Number(experience.price) > 0);
  totalScore += hasPrice ? 10 : 0;
  if (!hasPrice) infoMissingFields.push('price');

  // Bucket 4: Métricas (10)
  const hasTravelTime = !!(
    experience.travelTime !== null &&
    experience.travelTime !== undefined &&
    experience.travelTime > 0
  );
  const hasTotalDistance = !!(
    experience.totalDistance !== null &&
    experience.totalDistance !== undefined &&
    experience.totalDistance > 0
  );
  const hasDifficulty = !!(experience.difficultyLevel && Number(experience.difficultyLevel) > 0);
  const metricsCount = [hasTravelTime, hasTotalDistance, hasDifficulty].filter(Boolean).length;
  totalScore += (metricsCount / 3) * 10;
  if (!hasTravelTime) infoMissingFields.push('travelTime');
  if (!hasTotalDistance) infoMissingFields.push('totalDistance');
  if (!hasDifficulty) infoMissingFields.push('difficultyLevel');

  // Bucket 5: Recomendaciones (10) — at least 2 of 4 filled
  const hasMinAge = experience.minAge !== null && experience.minAge !== undefined;
  const hasMaxAge = experience.maxAge !== null && experience.maxAge !== undefined;
  const hasRestrictions = !!(experience.restrictions && experience.restrictions.trim().length > 0);
  const hasHowToDress = !!(experience.howToDress && experience.howToDress.trim().length > 0);
  const recoCount = [hasMinAge, hasMaxAge, hasRestrictions, hasHowToDress].filter(Boolean).length;
  totalScore += Math.min(recoCount / 2, 1) * 10;
  if (!hasMinAge) infoMissingFields.push('minAge');
  if (!hasMaxAge) infoMissingFields.push('maxAge');
  if (!hasRestrictions) infoMissingFields.push('restrictions');
  if (!hasHowToDress) infoMissingFields.push('howToDress');

  // Bucket 6: Categorías (10) — critical
  const hasCategories = !!(experience.categories && experience.categories.length >= 1);
  totalScore += hasCategories ? 10 : 0;
  if (!hasCategories) infoMissingFields.push('categories');

  // Bucket 7: Fotos (20) — images>=3 critical
  const imageCount = (experience.images ?? []).length;
  const hasImages = imageCount >= 3;
  totalScore += hasImages ? 20 : 0;
  if (!hasImages) infoMissingFields.push('images');

  const infoCriticalSatisfied =
    hasTitle && hasDescription && hasDeparture && hasArrival && hasPrice && hasCategories && hasImages;
  const infoPercentage = Math.round(Math.min(100, Math.max(0, totalScore)));

  return { infoPercentage, infoMissingFields, infoCriticalSatisfied };
}

// =================================================================================================
// Terms + Docs status — identical shape to other entities.
// Experience REUSES Guide T&C (semantic: experience is a guide-owned product).
// =================================================================================================

export type ExperienceTermsStatusState = 'no_aplica' | 'aceptados' | 'pendientes';

export interface ExperienceTermsStatus {
  state: ExperienceTermsStatusState;
  activeTermsId?: string | null;
}

export function computeExperienceTermsStatus(args: {
  hasActiveGuideTerms: boolean;
  hasAcceptedGuideTerms: boolean;
  activeTermsId?: string | null;
}): ExperienceTermsStatus {
  if (!args.hasActiveGuideTerms) return { state: 'no_aplica', activeTermsId: null };
  return {
    state: args.hasAcceptedGuideTerms ? 'aceptados' : 'pendientes',
    activeTermsId: args.activeTermsId ?? null,
  };
}

export type ExperienceDocsStatusState = 'no_requeridos' | 'opcionales' | 'incompletos' | 'completos';

export interface ExperienceDocsStatus {
  state: ExperienceDocsStatusState;
  uploaded: number;
  required: number;
  missing: string[];
}

export interface ExperienceDocStatusInput {
  documentTypeName: string;
  isRequired: boolean;
  isUploaded: boolean;
  isExpired: boolean;
}

export function computeExperienceDocsStatus(docs: ExperienceDocStatusInput[]): ExperienceDocsStatus {
  const required = docs.filter(d => d.isRequired);
  if (required.length === 0) {
    return {
      state: docs.length === 0 ? 'no_requeridos' : 'opcionales',
      uploaded: 0,
      required: 0,
      missing: [],
    };
  }
  const validRequired = required.filter(d => d.isUploaded && !d.isExpired);
  const missing = required.filter(d => !d.isUploaded || d.isExpired).map(d => d.documentTypeName);
  return {
    state: missing.length === 0 ? 'completos' : 'incompletos',
    uploaded: validRequired.length,
    required: required.length,
    missing,
  };
}

// =================================================================================================
// Combined wrapper
// =================================================================================================

export interface ExperienceCompletionResult {
  infoPercentage: number;
  infoMissingFields: string[];
  infoCriticalSatisfied: boolean;
  termsStatus?: ExperienceTermsStatus;
  docsStatus?: ExperienceDocsStatus;
  readyToSubmit?: boolean;
  completionPercentage: number;
  missingFields: string[];
  criticalSatisfied: boolean;
}

export function computeExperienceCompletion(
  experience: Experience,
  context?: { termsStatus: ExperienceTermsStatus; docsStatus: ExperienceDocsStatus },
): ExperienceCompletionResult {
  const info = computeExperienceInfoCompletion(experience);
  const base: ExperienceCompletionResult = {
    ...info,
    completionPercentage: info.infoPercentage,
    missingFields: info.infoMissingFields,
    criticalSatisfied: info.infoCriticalSatisfied,
  };
  if (!context) return base;

  const infoOK = info.infoPercentage >= 80 && info.infoCriticalSatisfied;
  const termsOK = context.termsStatus.state !== 'pendientes';

  return {
    ...base,
    termsStatus: context.termsStatus,
    docsStatus: context.docsStatus,
    // Docs are NOT part of the publish gate (freemium) — they only gate the Verified seal.
    readyToSubmit: infoOK && termsOK,
  };
}
