import { Restaurant } from '../entities';

// =================================================================================================
// Info completion — mirror of computeLodgingInfoCompletion / computeCommerceInfoCompletion
// =================================================================================================

export interface RestaurantInfoCompletionResult {
  infoPercentage: number;
  infoMissingFields: string[];
  infoCriticalSatisfied: boolean;
}

/**
 * Weighted buckets per wizard-restaurant-research.md §8.1:
 *  - Información básica (20%): name, description>=50, townId, address, categories>=1
 *  - Contacto         (15%): whatsappNumbers>=1 (critical), email OR phoneNumbers>=1
 *  - Price            (10%): lowestPrice>0 (critical)
 *  - Menú             (20%): menus>=1 with status='completed' OR menuNotApplicable=true (critical)
 *  - Photos           (20%): images>=3 (critical)
 *  - Servicios        (10%): facilities>=1 AND paymentMethods>=1 AND spokenLanguages>=1
 *  - Ubicación         (5%): location non-null
 */
export function computeRestaurantInfoCompletion(restaurant: Restaurant): RestaurantInfoCompletionResult {
  const infoMissingFields: string[] = [];
  let totalScore = 0;

  // Bucket 1: Información básica (20)
  const basic = {
    name: !!(restaurant.name && restaurant.name.trim().length > 0),
    description: !!(restaurant.description && restaurant.description.trim().length >= 50),
    townId: !!restaurant.town?.id,
    address: !!(restaurant.address && restaurant.address.trim().length > 0),
    categories: !!(restaurant.categories && restaurant.categories.length >= 1),
  };
  totalScore += (Object.values(basic).filter(Boolean).length / 5) * 20;
  if (!basic.name) infoMissingFields.push('name');
  if (!basic.description) infoMissingFields.push('description');
  if (!basic.townId) infoMissingFields.push('townId');
  if (!basic.address) infoMissingFields.push('address');
  if (!basic.categories) infoMissingFields.push('categories');

  // Bucket 2: Contacto (15)
  const hasWhatsapp = !!(restaurant.whatsappNumbers && restaurant.whatsappNumbers.length >= 1);
  const hasEmailOrPhone =
    !!(restaurant.email && restaurant.email.trim().length > 0) ||
    !!(restaurant.phoneNumbers && restaurant.phoneNumbers.length >= 1);
  totalScore += (((hasWhatsapp ? 1 : 0) + (hasEmailOrPhone ? 1 : 0)) / 2) * 15;
  if (!hasWhatsapp) infoMissingFields.push('whatsappNumbers');

  // Bucket 3: Price (10)
  const hasLowestPrice =
    (restaurant.lowestPrice !== null && restaurant.lowestPrice !== undefined && Number(restaurant.lowestPrice) > 0) ||
    restaurant.menuNotApplicable === true;
  totalScore += hasLowestPrice ? 10 : 0;
  if (!hasLowestPrice) infoMissingFields.push('lowestPrice');

  // Bucket 4: Menú (20) — critical UNLESS opted out via menuNotApplicable
  const completedMenus = (restaurant.menus ?? []).filter(m => m.status === 'completed');
  const hasMenu =
    completedMenus.length >= 1 ||
    !!(restaurant.menuUrl && restaurant.menuUrl.trim().length > 0) ||
    restaurant.menuNotApplicable === true;
  totalScore += hasMenu ? 20 : 0;
  if (!hasMenu) infoMissingFields.push('menus');

  // Bucket 5: Photos (20) — images>=3 critical
  const imageCount = (restaurant.images ?? []).filter(img => img.imageResource != null).length;
  const hasImages = imageCount >= 3;
  totalScore += hasImages ? 20 : 0;
  if (!hasImages) infoMissingFields.push('images');

  // Bucket 6: Servicios (10)
  const hasFacilities = !!(restaurant.facilities && restaurant.facilities.length >= 1);
  const hasPaymentMethods = !!(restaurant.paymentMethods && restaurant.paymentMethods.length >= 1);
  const hasLanguages = !!(restaurant.spokenLanguages && restaurant.spokenLanguages.length >= 1);
  totalScore += (((hasFacilities ? 1 : 0) + (hasPaymentMethods ? 1 : 0) + (hasLanguages ? 1 : 0)) / 3) * 10;
  if (!hasFacilities) infoMissingFields.push('facilities');
  if (!hasPaymentMethods) infoMissingFields.push('paymentMethods');
  if (!hasLanguages) infoMissingFields.push('spokenLanguages');

  // Bucket 7: Ubicación (5)
  const hasLocation = !!(restaurant.location && restaurant.location.coordinates);
  totalScore += hasLocation ? 5 : 0;
  if (!hasLocation) infoMissingFields.push('location');

  // Critical: whatsapp + lowestPrice + menu (or N/A) + images>=3
  const infoCriticalSatisfied = hasWhatsapp && hasLowestPrice && hasMenu && hasImages;
  const infoPercentage = Math.round(Math.min(100, Math.max(0, totalScore)));

  return { infoPercentage, infoMissingFields, infoCriticalSatisfied };
}

// =================================================================================================
// Terms + Docs status — identical shape to Lodging/Commerce
// =================================================================================================

export type RestaurantTermsStatusState = 'no_aplica' | 'aceptados' | 'pendientes';

export interface RestaurantTermsStatus {
  state: RestaurantTermsStatusState;
  activeTermsId?: string | null;
}

export function computeRestaurantTermsStatus(args: {
  hasActiveRestaurantTerms: boolean;
  hasAcceptedRestaurantTerms: boolean;
  activeTermsId?: string | null;
}): RestaurantTermsStatus {
  if (!args.hasActiveRestaurantTerms) return { state: 'no_aplica', activeTermsId: null };
  return {
    state: args.hasAcceptedRestaurantTerms ? 'aceptados' : 'pendientes',
    activeTermsId: args.activeTermsId ?? null,
  };
}

export type RestaurantDocsStatusState = 'no_requeridos' | 'opcionales' | 'incompletos' | 'completos';

export interface RestaurantDocsStatus {
  state: RestaurantDocsStatusState;
  uploaded: number;
  required: number;
  missing: string[];
}

export interface RestaurantDocStatusInput {
  documentTypeName: string;
  isRequired: boolean;
  isUploaded: boolean;
  isExpired: boolean;
}

export function computeRestaurantDocsStatus(docs: RestaurantDocStatusInput[]): RestaurantDocsStatus {
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

export interface RestaurantCompletionResult {
  infoPercentage: number;
  infoMissingFields: string[];
  infoCriticalSatisfied: boolean;
  termsStatus?: RestaurantTermsStatus;
  docsStatus?: RestaurantDocsStatus;
  readyToSubmit?: boolean;
  completionPercentage: number;
  missingFields: string[];
  criticalSatisfied: boolean;
}

export function computeRestaurantCompletion(
  restaurant: Restaurant,
  context?: { termsStatus: RestaurantTermsStatus; docsStatus: RestaurantDocsStatus },
): RestaurantCompletionResult {
  const info = computeRestaurantInfoCompletion(restaurant);
  const base: RestaurantCompletionResult = {
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
