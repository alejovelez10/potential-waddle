import { Guide } from '../entities/guide.entity';

// =================================================================================================
// Info completion — mirror of computeLodging/Restaurant/CommerceInfoCompletion
// =================================================================================================

export interface GuideInfoCompletionResult {
  infoPercentage: number;
  infoMissingFields: string[];
  infoCriticalSatisfied: boolean;
}

/**
 * Weighted buckets per Sprint 3 spec:
 *  - Identidad básica   (15%): firstName, lastName, documentType, document
 *  - Biografía          (15%): biography>=50 chars (critical)
 *  - Contacto           (15%): whatsapp (critical), email or phone
 *  - Idiomas            (10%): languages>=1 (critical)
 *  - Categorías         (10%): categories>=1 (critical)
 *  - Cobertura          (15%): towns>=1 (critical)
 *  - Fotos              (20%): images>=3 (critical)
 *
 * Critical: whatsapp + biography>=50 + languages + categories + towns + images>=3
 * Redes sociales (facebook/instagram/youtube/tiktok) are optional and tracked by
 * the FE skip-penalty hook, not by the gate.
 */
export function computeGuideInfoCompletion(guide: Guide): GuideInfoCompletionResult {
  const infoMissingFields: string[] = [];
  let totalScore = 0;

  // Bucket 1: Identidad (15)
  const identity = {
    firstName: !!(guide.firstName && guide.firstName.trim().length > 0),
    lastName: !!(guide.lastName && guide.lastName.trim().length > 0),
    documentType: !!(guide.documentType && guide.documentType.trim().length > 0),
    document: !!(guide.document && guide.document.trim().length > 0),
  };
  totalScore += (Object.values(identity).filter(Boolean).length / 4) * 15;
  if (!identity.firstName) infoMissingFields.push('firstName');
  if (!identity.lastName) infoMissingFields.push('lastName');
  if (!identity.documentType) infoMissingFields.push('documentType');
  if (!identity.document) infoMissingFields.push('document');

  // Bucket 2: Biografía (15) — critical
  const hasBiography = !!(guide.biography && guide.biography.trim().length >= 50);
  totalScore += hasBiography ? 15 : 0;
  if (!hasBiography) infoMissingFields.push('biography');

  // Bucket 3: Contacto (15) — whatsapp critical + email or phone
  const hasWhatsapp = !!(guide.whatsapp && guide.whatsapp.trim().length > 0);
  const hasEmailOrPhone =
    !!(guide.email && guide.email.trim().length > 0) || !!(guide.phone && guide.phone.trim().length > 0);
  totalScore += (((hasWhatsapp ? 1 : 0) + (hasEmailOrPhone ? 1 : 0)) / 2) * 15;
  if (!hasWhatsapp) infoMissingFields.push('whatsapp');

  // Bucket 4: Idiomas (10) — critical
  const hasLanguages = !!(guide.languages && guide.languages.length >= 1);
  totalScore += hasLanguages ? 10 : 0;
  if (!hasLanguages) infoMissingFields.push('languages');

  // Bucket 5: Categorías (10) — critical
  const hasCategories = !!(guide.categories && guide.categories.length >= 1);
  totalScore += hasCategories ? 10 : 0;
  if (!hasCategories) infoMissingFields.push('categories');

  // Bucket 6: Cobertura (15) — critical, towns>=1
  const hasTowns = !!(guide.towns && guide.towns.length >= 1);
  totalScore += hasTowns ? 15 : 0;
  if (!hasTowns) infoMissingFields.push('towns');

  // Bucket 7: Fotos (20) — images>=3 critical
  const imageCount = (guide.images ?? []).length;
  const hasImages = imageCount >= 3;
  totalScore += hasImages ? 20 : 0;
  if (!hasImages) infoMissingFields.push('images');

  const infoCriticalSatisfied = hasWhatsapp && hasBiography && hasLanguages && hasCategories && hasTowns && hasImages;
  const infoPercentage = Math.round(Math.min(100, Math.max(0, totalScore)));

  return { infoPercentage, infoMissingFields, infoCriticalSatisfied };
}

// =================================================================================================
// Terms + Docs status — identical shape to Lodging/Restaurant/Commerce
// =================================================================================================

export type GuideTermsStatusState = 'no_aplica' | 'aceptados' | 'pendientes';

export interface GuideTermsStatus {
  state: GuideTermsStatusState;
  activeTermsId?: string | null;
}

export function computeGuideTermsStatus(args: {
  hasActiveGuideTerms: boolean;
  hasAcceptedGuideTerms: boolean;
  activeTermsId?: string | null;
}): GuideTermsStatus {
  if (!args.hasActiveGuideTerms) return { state: 'no_aplica', activeTermsId: null };
  return {
    state: args.hasAcceptedGuideTerms ? 'aceptados' : 'pendientes',
    activeTermsId: args.activeTermsId ?? null,
  };
}

export type GuideDocsStatusState = 'no_requeridos' | 'opcionales' | 'incompletos' | 'completos';

export interface GuideDocsStatus {
  state: GuideDocsStatusState;
  uploaded: number;
  required: number;
  missing: string[];
}

export interface GuideDocStatusInput {
  documentTypeName: string;
  isRequired: boolean;
  isUploaded: boolean;
  isExpired: boolean;
}

export function computeGuideDocsStatus(docs: GuideDocStatusInput[]): GuideDocsStatus {
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

export interface GuideCompletionResult {
  infoPercentage: number;
  infoMissingFields: string[];
  infoCriticalSatisfied: boolean;
  termsStatus?: GuideTermsStatus;
  docsStatus?: GuideDocsStatus;
  readyToSubmit?: boolean;
  completionPercentage: number;
  missingFields: string[];
  criticalSatisfied: boolean;
}

export function computeGuideCompletion(
  guide: Guide,
  context?: { termsStatus: GuideTermsStatus; docsStatus: GuideDocsStatus },
): GuideCompletionResult {
  const info = computeGuideInfoCompletion(guide);
  const base: GuideCompletionResult = {
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
