import { Lodging } from '../entities';

// =================================================================================================
// Info completion — gradual % across data buckets
// =================================================================================================

export interface LodgingInfoCompletionResult {
  infoPercentage: number;
  infoMissingFields: string[];
  infoCriticalSatisfied: boolean;
}

/**
 * Data-fields completion of a lodging (Info / Contact / Price / Rooms / Photos / Services / Location).
 * Does NOT consider Terms or Documents — those are separate, binary gates with their own functions.
 *
 * Weighted buckets per BACKEND-SPEC §5:
 *  - Basic info      (20%): name, description>=50, townId, address, categories>=1
 *  - Contact         (15%): whatsappNumbers>=1 (critical), email OR phoneNumbers>=1
 *  - Price           (10%): lowestPrice>0 (critical)
 *  - Room types      (20%): lodgingRoomTypes>=1 with name+price+maxCapacity (critical, unless roomsNotApplicable)
 *  - Photos          (20%): images>=3 (critical)
 *  - Services        (10%): amenities>=1 AND facilities>=1 AND paymentMethods>=1
 *  - Location         (5%): location non-null
 */
export function computeLodgingInfoCompletion(lodging: Lodging): LodgingInfoCompletionResult {
  const infoMissingFields: string[] = [];
  let totalScore = 0;

  // ----------------------------------------------------------------------------------------------
  // Bucket 1: Información básica (weight 20)
  // ----------------------------------------------------------------------------------------------
  const basicConditions = {
    name: !!(lodging.name && lodging.name.trim().length > 0),
    description: !!(lodging.description && lodging.description.trim().length >= 50),
    townId: !!lodging.town?.id,
    address: !!(lodging.address && lodging.address.trim().length > 0),
    categories: !!(lodging.categories && lodging.categories.length >= 1),
  };

  const basicSatisfied = Object.values(basicConditions).filter(Boolean).length;
  const basicTotal = Object.keys(basicConditions).length;
  totalScore += (basicSatisfied / basicTotal) * 20;

  if (!basicConditions.name) infoMissingFields.push('name');
  if (!basicConditions.description) infoMissingFields.push('description');
  if (!basicConditions.townId) infoMissingFields.push('townId');
  if (!basicConditions.address) infoMissingFields.push('address');
  if (!basicConditions.categories) infoMissingFields.push('categories');

  // ----------------------------------------------------------------------------------------------
  // Bucket 2: Contacto (weight 15) — whatsappNumbers>=1 critical; email OR phoneNumbers>=1 sub-condition
  // ----------------------------------------------------------------------------------------------
  const hasWhatsapp = !!(lodging.whatsappNumbers && lodging.whatsappNumbers.length >= 1);
  const hasEmailOrPhone =
    !!(lodging.email && lodging.email.trim().length > 0) ||
    !!(lodging.phoneNumbers && lodging.phoneNumbers.length >= 1);

  const contactSatisfied = (hasWhatsapp ? 1 : 0) + (hasEmailOrPhone ? 1 : 0);
  const contactTotal = 2;
  totalScore += (contactSatisfied / contactTotal) * 15;

  if (!hasWhatsapp) infoMissingFields.push('whatsappNumbers');

  // ----------------------------------------------------------------------------------------------
  // Bucket 3: Precio (weight 10)
  // ----------------------------------------------------------------------------------------------
  const hasLowestPrice = !!(
    lodging.lowestPrice !== null &&
    lodging.lowestPrice !== undefined &&
    Number(lodging.lowestPrice) > 0
  );

  totalScore += hasLowestPrice ? 10 : 0;

  if (!hasLowestPrice) infoMissingFields.push('lowestPrice');

  // ----------------------------------------------------------------------------------------------
  // Bucket 4: Habitaciones (weight 20) — at least 1 valid room type, unless roomsNotApplicable opt-out
  // ----------------------------------------------------------------------------------------------
  const validRoomTypes = (lodging.lodgingRoomTypes ?? []).filter(
    rt => rt.name && rt.name.trim().length > 0 && Number(rt.price) > 0 && rt.maxCapacity > 0,
  );
  const hasRoomTypes = validRoomTypes.length >= 1 || lodging.roomsNotApplicable === true;

  totalScore += hasRoomTypes ? 20 : 0;

  if (!hasRoomTypes) infoMissingFields.push('lodgingRoomTypes');

  // ----------------------------------------------------------------------------------------------
  // Bucket 5: Fotos (weight 20) — images>=3 critical
  // ----------------------------------------------------------------------------------------------
  const imageCount = (lodging.images ?? []).filter(img => img.imageResource != null).length;
  const hasImages = imageCount >= 3;

  totalScore += hasImages ? 20 : 0;

  if (!hasImages) infoMissingFields.push('images');

  // ----------------------------------------------------------------------------------------------
  // Bucket 6: Servicios (weight 10) — amenities>=1 AND facilities>=1 AND paymentMethods>=1
  // ----------------------------------------------------------------------------------------------
  const hasAmenities = !!(lodging.amenities && lodging.amenities.length >= 1);
  const hasFacilities = !!(lodging.facilities && lodging.facilities.length >= 1);
  const hasPaymentMethods = !!(lodging.paymentMethods && lodging.paymentMethods.length >= 1);

  const servicesSatisfied = (hasAmenities ? 1 : 0) + (hasFacilities ? 1 : 0) + (hasPaymentMethods ? 1 : 0);
  const servicesTotal = 3;
  totalScore += (servicesSatisfied / servicesTotal) * 10;

  if (!hasAmenities) infoMissingFields.push('amenities');
  if (!hasFacilities) infoMissingFields.push('facilities');
  if (!hasPaymentMethods) infoMissingFields.push('paymentMethods');

  // ----------------------------------------------------------------------------------------------
  // Bucket 7: Ubicación (weight 5)
  // ----------------------------------------------------------------------------------------------
  const hasLocation = !!(lodging.location && lodging.location.coordinates);

  totalScore += hasLocation ? 5 : 0;

  if (!hasLocation) infoMissingFields.push('location');

  // ----------------------------------------------------------------------------------------------
  // Critical: whatsapp, lowestPrice, roomTypes (or N/A), images>=3
  // ----------------------------------------------------------------------------------------------
  const infoCriticalSatisfied = hasWhatsapp && hasLowestPrice && hasRoomTypes && hasImages;

  const infoPercentage = Math.round(Math.min(100, Math.max(0, totalScore)));

  return { infoPercentage, infoMissingFields, infoCriticalSatisfied };
}

// =================================================================================================
// Terms status — binary gate (per-user globally for this entity type)
// =================================================================================================

export type LodgingTermsStatusState = 'no_aplica' | 'aceptados' | 'pendientes';

export interface LodgingTermsStatus {
  state: LodgingTermsStatusState;
  /**
   * ID of the active lodging T&C document version. Carried through so the frontend can
   * redirect to the accept-terms screen when state==='pendientes' without re-fetching.
   */
  activeTermsId?: string | null;
}

/**
 * T&C acceptance status for a lodging owner.
 *
 * T&C is recorded per-user-globally (one TermsAcceptance row per user per TermsDocument version),
 * not per-lodging — the same user accepting once covers all their lodgings.
 *
 *  - no_aplica  → no active lodging T&C version exists yet (admin hasn't published one)
 *  - aceptados  → user has accepted the currently-active version
 *  - pendientes → active version exists but user hasn't accepted it (or accepted a stale one)
 */
export function computeLodgingTermsStatus(args: {
  hasActiveLodgingTerms: boolean;
  hasAcceptedLodgingTerms: boolean;
  activeTermsId?: string | null;
}): LodgingTermsStatus {
  if (!args.hasActiveLodgingTerms) return { state: 'no_aplica', activeTermsId: null };
  return {
    state: args.hasAcceptedLodgingTerms ? 'aceptados' : 'pendientes',
    activeTermsId: args.activeTermsId ?? null,
  };
}

// =================================================================================================
// Docs status — checklist gate (per-lodging, filtered by town × categories)
// =================================================================================================

export type LodgingDocsStatusState = 'no_requeridos' | 'opcionales' | 'incompletos' | 'completos';

export interface LodgingDocsStatus {
  state: LodgingDocsStatusState;
  uploaded: number;
  required: number;
  missing: string[];
}

/**
 * Minimal input shape (subset of EntityDocumentStatusDto fields used by the compute).
 * Caller adapts the DTO into this shape so the function stays decoupled.
 */
export interface LodgingDocStatusInput {
  documentTypeName: string;
  isRequired: boolean;
  isUploaded: boolean;
  isExpired: boolean;
}

/**
 * Docs status for a lodging given the already-resolved requirement list
 * (output of DocumentService.getEntityDocumentStatus, narrowed to minimal fields).
 *
 *  - no_requeridos → no requirements configured for (town, LODGING, categories)
 *  - opcionales   → requirements exist but all are optional
 *  - completos    → all required docs are uploaded and not expired
 *  - incompletos  → at least one required doc is missing or expired
 *
 * `uploaded`/`required` count REQUIRED docs only — the M/N shown in the UI reflects
 * "what blocks publish", not how many forms the user filled.
 */
export function computeLodgingDocsStatus(docs: LodgingDocStatusInput[]): LodgingDocsStatus {
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
// Combined wrapper — info% + terms + docs + rolled-up submit gate
// =================================================================================================

export interface LodgingCompletionResult {
  // New canonical fields
  infoPercentage: number;
  infoMissingFields: string[];
  infoCriticalSatisfied: boolean;

  // Side gates (present when context provided)
  termsStatus?: LodgingTermsStatus;
  docsStatus?: LodgingDocsStatus;

  // Rolled-up submit gate: info ≥80 + critical + terms not-pendientes (docs only gate verification)
  readyToSubmit?: boolean;

  // Backwards-compat aliases (= info fields). Kept so existing DTOs/services don't break.
  completionPercentage: number;
  missingFields: string[];
  criticalSatisfied: boolean;
}

/**
 * Combines the 3 independent completion indicators. Caller must pre-compute terms/docs status
 * because they need external relations (TermsService for the user, DocumentService for town×categories).
 *
 * Without context, returns info-only data (legacy callsite behavior, no readyToSubmit).
 */
export function computeLodgingCompletion(
  lodging: Lodging,
  context?: { termsStatus: LodgingTermsStatus; docsStatus: LodgingDocsStatus },
): LodgingCompletionResult {
  const info = computeLodgingInfoCompletion(lodging);

  const base: LodgingCompletionResult = {
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
