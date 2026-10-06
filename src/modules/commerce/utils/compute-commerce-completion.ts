import { Commerce } from '../entities';

// =================================================================================================
// Info completion — gradual % across data buckets (mirror of computeLodgingInfoCompletion)
// =================================================================================================

export interface CommerceInfoCompletionResult {
  infoPercentage: number;
  infoMissingFields: string[];
  infoCriticalSatisfied: boolean;
}

/**
 * Data-fields completion of a commerce (Info / Contact / Products / Photos / Services / Location).
 * Does NOT consider Terms or Documents — those are separate, binary gates with their own functions.
 *
 * Weighted buckets (sum to 100):
 *  - Información básica (20%): name, description>=50, townId, address, categories>=1
 *  - Contacto         (15%): whatsappNumbers>=1 (critical), email OR phoneNumbers>=1
 *  - Productos        (20%): commerceProducts>=1 with name + price>0 (critical)
 *  - Fotos            (20%): images>=3 (critical)
 *  - Servicios        (10%): services>=1 AND facilities>=1 AND paymentMethods>=1
 *  - Ubicación        (15%): location non-null
 */
export function computeCommerceInfoCompletion(commerce: Commerce): CommerceInfoCompletionResult {
  const infoMissingFields: string[] = [];
  let totalScore = 0;

  // Bucket 1: Información básica (20)
  const basicConditions = {
    name: !!(commerce.name && commerce.name.trim().length > 0),
    description: !!(commerce.description && commerce.description.trim().length >= 50),
    townId: !!commerce.town?.id,
    address: !!(commerce.address && commerce.address.trim().length > 0),
    categories: !!(commerce.categories && commerce.categories.length >= 1),
  };
  const basicSatisfied = Object.values(basicConditions).filter(Boolean).length;
  totalScore += (basicSatisfied / 5) * 20;
  if (!basicConditions.name) infoMissingFields.push('name');
  if (!basicConditions.description) infoMissingFields.push('description');
  if (!basicConditions.townId) infoMissingFields.push('townId');
  if (!basicConditions.address) infoMissingFields.push('address');
  if (!basicConditions.categories) infoMissingFields.push('categories');

  // Bucket 2: Contacto (15) — whatsapp critical + (email OR phone)
  const hasWhatsapp = !!(commerce.whatsappNumbers && commerce.whatsappNumbers.length >= 1);
  const hasEmailOrPhone =
    !!(commerce.email && commerce.email.trim().length > 0) ||
    !!(commerce.phoneNumbers && commerce.phoneNumbers.length >= 1);
  totalScore += (((hasWhatsapp ? 1 : 0) + (hasEmailOrPhone ? 1 : 0)) / 2) * 15;
  if (!hasWhatsapp) infoMissingFields.push('whatsappNumbers');

  // Bucket 3: Productos / Servicios (20) — at least 1 valid product (name + price>0) critical
  const validProducts = (commerce.products ?? []).filter(
    p => p.name && p.name.trim().length > 0 && Number(p.price) > 0,
  );
  const hasProducts = validProducts.length >= 1;
  totalScore += hasProducts ? 20 : 0;
  if (!hasProducts) infoMissingFields.push('commerceProducts');

  // Bucket 4: Fotos (20) — images>=3 critical
  const imageCount = (commerce.images ?? []).filter(img => img.imageResource != null).length;
  const hasImages = imageCount >= 3;
  totalScore += hasImages ? 20 : 0;
  if (!hasImages) infoMissingFields.push('images');

  // Bucket 5: Servicios secundarios (10) — facilities + paymentMethods only.
  // The legacy `services` slug has no input in the commerce wizard, so counting
  // it would permanently strand commerce completion at ~97%.
  const hasFacilities = !!(commerce.facilities && commerce.facilities.length >= 1);
  const hasPaymentMethods = !!(commerce.paymentMethods && commerce.paymentMethods.length >= 1);
  totalScore += (((hasFacilities ? 1 : 0) + (hasPaymentMethods ? 1 : 0)) / 2) * 10;
  if (!hasFacilities) infoMissingFields.push('facilities');
  if (!hasPaymentMethods) infoMissingFields.push('paymentMethods');

  // Bucket 6: Ubicación (15)
  const hasLocation = !!(commerce.location && commerce.location.coordinates);
  totalScore += hasLocation ? 15 : 0;
  if (!hasLocation) infoMissingFields.push('location');

  // Critical: whatsapp, commerceProducts, images>=3
  const infoCriticalSatisfied = hasWhatsapp && hasProducts && hasImages;
  const infoPercentage = Math.round(Math.min(100, Math.max(0, totalScore)));

  return { infoPercentage, infoMissingFields, infoCriticalSatisfied };
}

// =================================================================================================
// Terms status — binary gate (per-user globally). Mirror of computeLodgingTermsStatus.
// =================================================================================================

export type CommerceTermsStatusState = 'no_aplica' | 'aceptados' | 'pendientes';

export interface CommerceTermsStatus {
  state: CommerceTermsStatusState;
  activeTermsId?: string | null;
}

export function computeCommerceTermsStatus(args: {
  hasActiveCommerceTerms: boolean;
  hasAcceptedCommerceTerms: boolean;
  activeTermsId?: string | null;
}): CommerceTermsStatus {
  if (!args.hasActiveCommerceTerms) return { state: 'no_aplica', activeTermsId: null };
  return {
    state: args.hasAcceptedCommerceTerms ? 'aceptados' : 'pendientes',
    activeTermsId: args.activeTermsId ?? null,
  };
}

// =================================================================================================
// Docs status — checklist gate per (town × categories). Mirror of computeLodgingDocsStatus.
// =================================================================================================

export type CommerceDocsStatusState = 'no_requeridos' | 'opcionales' | 'incompletos' | 'completos';

export interface CommerceDocsStatus {
  state: CommerceDocsStatusState;
  uploaded: number;
  required: number;
  missing: string[];
}

export interface CommerceDocStatusInput {
  documentTypeName: string;
  isRequired: boolean;
  isUploaded: boolean;
  isExpired: boolean;
}

export function computeCommerceDocsStatus(docs: CommerceDocStatusInput[]): CommerceDocsStatus {
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
// Combined wrapper — backward-compat shape + 3-indicator + readyToSubmit
// =================================================================================================

export interface CommerceCompletionResult {
  infoPercentage: number;
  infoMissingFields: string[];
  infoCriticalSatisfied: boolean;
  termsStatus?: CommerceTermsStatus;
  docsStatus?: CommerceDocsStatus;
  readyToSubmit?: boolean;
  // Backwards-compat aliases
  completionPercentage: number;
  missingFields: string[];
  criticalSatisfied: boolean;
}

export function computeCommerceCompletion(
  commerce: Commerce,
  context?: { termsStatus: CommerceTermsStatus; docsStatus: CommerceDocsStatus },
): CommerceCompletionResult {
  const info = computeCommerceInfoCompletion(commerce);
  const base: CommerceCompletionResult = {
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
