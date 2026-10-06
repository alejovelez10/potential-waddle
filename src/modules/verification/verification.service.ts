import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { DocumentService } from '../documents/services';
import { DocumentEntityType, DocumentStatus } from '../documents/enums';
import { ResendService } from '../email/services/resend.service';
import { User } from '../users/entities';
import {
  EntityVerification,
  VERIFICATION_ENTITY_TYPES,
  VerificationEntityType,
  VerificationStatus,
} from './entities/entity-verification.entity';

interface EntityContext {
  id: string;
  name: string;
  ownerEmail: string | null;
  whatsapp: string | null;
  townId: string | null;
  categoryIds: string[];
}

export interface VerificationDocumentsSummary {
  /** Required document types for this business (town × entity type × categories). */
  required: number;
  uploaded: number;
  approved: number;
  /** Required documents not uploaded yet (or expired). */
  missing: string[];
  /** Uploaded required documents waiting for Binntu's review. */
  pendingReview: string[];
  /** Required documents rejected by Binntu (must be re-uploaded). */
  rejected: string[];
}

export interface VerificationState {
  entityType: VerificationEntityType;
  entityId: string;
  status: VerificationStatus | 'none';
  requestedAt: Date | null;
  verifiedAt: Date | null;
  rejectionReason: string | null;
  documents: VerificationDocumentsSummary;
  /** True when the owner can submit (or re-submit) the request right now. */
  canRequest: boolean;
}

/**
 * Whitelisted context SQL per verifiable type ($1 = entity id). Returns the business name, owner
 * email, a contact WhatsApp, the reference town for document requirements (guides use their first
 * town, like the onboarding docs step) and the category ids used for document exclusions.
 */
const CONTEXT_QUERY: Record<VerificationEntityType, string> = {
  lodging: `SELECT e.id, e.name, u.email AS owner_email, e.whatsapp_numbers[1] AS whatsapp, e.town_id,
      ARRAY(SELECT category_id FROM "lodging_category" WHERE lodging_id = e.id) AS category_ids
    FROM "lodging" e LEFT JOIN "users" u ON u.id = e.user_id WHERE e.id = $1`,
  restaurant: `SELECT e.id, e.name, u.email AS owner_email, e.whatsapp_numbers[1] AS whatsapp, e.town_id,
      ARRAY(SELECT category_id FROM "restaurant_category" WHERE restaurant_id = e.id) AS category_ids
    FROM "restaurant" e LEFT JOIN "users" u ON u.id = e.user_id WHERE e.id = $1`,
  commerce: `SELECT e.id, e.name, u.email AS owner_email, e.whatsapp_numbers[1] AS whatsapp, e.town_id,
      ARRAY(SELECT category_id FROM "commerce_category" WHERE commerce_id = e.id) AS category_ids
    FROM "commerce" e LEFT JOIN "users" u ON u.id = e.user_id WHERE e.id = $1`,
  guide: `SELECT e.id, CONCAT_WS(' ', e.first_name, e.last_name) AS name, u.email AS owner_email, e.whatsapp,
      (SELECT town_id FROM "guide_town" WHERE guide_id = e.id LIMIT 1) AS town_id,
      ARRAY(SELECT category_id FROM "guide_category" WHERE guide_id = e.id) AS category_ids
    FROM "guide" e LEFT JOIN "users" u ON u.id = e.user_id WHERE e.id = $1`,
  transport: `SELECT e.id, CONCAT_WS(' ', e.first_name, e.last_name) AS name, u.email AS owner_email, e.whatsapp, e.town_id,
      ARRAY(SELECT category_id FROM "transport_category" WHERE transport_id = e.id) AS category_ids
    FROM "transport" e LEFT JOIN "users" u ON u.id = e.user_id WHERE e.id = $1`,
};

const PROFILE_PATH: Record<VerificationEntityType, string> = {
  lodging: 'lodgings',
  restaurant: 'restaurants',
  commerce: 'commerce',
  guide: 'guides',
  transport: 'transport',
};

@Injectable()
export class VerificationService {
  private readonly logger = new Logger(VerificationService.name);

  constructor(
    @InjectRepository(EntityVerification)
    private readonly verificationRepository: Repository<EntityVerification>,
    private readonly documentService: DocumentService,
    private readonly resendService: ResendService,
  ) {}

  // * ----------------------------------------------------------------------------------------------------------------
  // * PUBLIC READS (batch-friendly, used by the public list/detail DTOs)
  // * ----------------------------------------------------------------------------------------------------------------

  /** Verified ids for a type. Experiences inherit the seal from their guide. */
  async getVerifiedIdSet(entityType: string): Promise<Set<string>> {
    if (entityType === 'experience') {
      const rows: { id: string }[] = await this.verificationRepository.manager.query(
        `SELECT e.id FROM "experience" e
         JOIN "entity_verification" v ON v.entity_type = 'guide' AND v.entity_id = e.guide_id AND v.status = 'verified'`,
      );
      return new Set(rows.map(r => r.id));
    }
    if (!this.isVerifiableType(entityType)) return new Set();

    const rows = await this.verificationRepository.find({
      select: { entityId: true },
      where: { entityType, status: 'verified' },
    });
    return new Set(rows.map(r => r.entityId));
  }

  async isVerified(entityType: string, entityId: string): Promise<boolean> {
    if (entityType === 'experience') {
      const rows: { verified: boolean }[] = await this.verificationRepository.manager.query(
        `SELECT EXISTS (
           SELECT 1 FROM "experience" e
           JOIN "entity_verification" v ON v.entity_type = 'guide' AND v.entity_id = e.guide_id AND v.status = 'verified'
           WHERE e.id = $1
         ) AS verified`,
        [entityId],
      );
      return !!rows[0]?.verified;
    }
    if (!this.isVerifiableType(entityType)) return false;
    return this.verificationRepository.exist({ where: { entityType, entityId, status: 'verified' } });
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * OWNER
  // * ----------------------------------------------------------------------------------------------------------------

  async getState(entityType: string, entityId: string): Promise<VerificationState> {
    const type = this.assertVerifiableType(entityType);
    const context = await this.loadContext(type, entityId);
    const [verification, documents] = await Promise.all([
      this.verificationRepository.findOne({ where: { entityType: type, entityId: context.id } }),
      this.summarizeDocuments(type, context),
    ]);

    const status = verification?.status ?? 'none';
    const canRequest =
      (status === 'none' || status === 'rejected' || status === 'revoked') &&
      documents.required > 0 &&
      documents.missing.length === 0;

    return {
      entityType: type,
      entityId: context.id,
      status,
      requestedAt: verification?.requestedAt ?? null,
      verifiedAt: verification?.verifiedAt ?? null,
      rejectionReason: verification?.rejectionReason ?? null,
      documents,
      canRequest,
    };
  }

  async request(entityType: string, entityId: string): Promise<VerificationState> {
    const type = this.assertVerifiableType(entityType);
    const context = await this.loadContext(type, entityId);
    const documents = await this.summarizeDocuments(type, context);
    const existing = await this.verificationRepository.findOne({ where: { entityType: type, entityId: context.id } });

    if (existing?.status === 'requested') {
      throw new BadRequestException({
        errorCode: 'VERIFICATION_ALREADY_REQUESTED',
        message: 'La verificación ya está en revisión',
      });
    }
    if (existing?.status === 'verified') {
      throw new BadRequestException({
        errorCode: 'VERIFICATION_ALREADY_VERIFIED',
        message: 'El negocio ya está verificado',
      });
    }
    if (documents.required === 0) {
      throw new BadRequestException({
        errorCode: 'VERIFICATION_NOT_CONFIGURED',
        message: 'Aún no hay documentos de verificación configurados para este municipio',
      });
    }
    if (documents.missing.length > 0) {
      throw new BadRequestException({
        errorCode: 'VERIFICATION_DOCS_INCOMPLETE',
        message: 'Sube todos los documentos requeridos para solicitar la verificación',
        missing: documents.missing,
      });
    }

    const verification = existing ?? this.verificationRepository.create({ entityType: type, entityId: context.id });
    verification.status = 'requested';
    verification.requestedAt = new Date();
    verification.rejectionReason = null;
    await this.verificationRepository.save(verification);

    void this.resendService.sendAdminNotification({
      subject: `Solicitud de verificación: ${context.name}`,
      title: 'Nueva solicitud de verificación',
      intro:
        'Un prestador subió sus documentos y solicita el sello Verificado. Revisa cada documento y otorga o rechaza el sello.',
      rows: [
        ['Negocio', context.name],
        ['Tipo', type],
        ['Propietario', context.ownerEmail],
        ['WhatsApp', context.whatsapp],
      ],
      path: '/admin/validaciones?tab=verificaciones',
      ctaLabel: 'Revisar documentos',
    });

    return this.getState(type, context.id);
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * ADMIN (Binntu staff)
  // * ----------------------------------------------------------------------------------------------------------------

  async findQueue(status: VerificationStatus = 'requested') {
    const rows = await this.verificationRepository.find({
      where: { status, entityType: In([...VERIFICATION_ENTITY_TYPES]) },
      order: { requestedAt: 'ASC' },
    });

    return Promise.all(
      rows.map(async row => {
        const context = await this.loadContext(row.entityType, row.entityId).catch(() => null);
        return {
          id: row.id,
          entityType: row.entityType,
          entityId: row.entityId,
          entityName: context?.name ?? null,
          ownerEmail: context?.ownerEmail ?? null,
          whatsapp: context?.whatsapp ?? null,
          status: row.status,
          requestedAt: row.requestedAt,
          verifiedAt: row.verifiedAt,
          rejectionReason: row.rejectionReason,
          documents: context ? await this.summarizeDocuments(row.entityType, context) : null,
        };
      }),
    );
  }

  async approve(entityType: string, entityId: string, reviewer: User): Promise<VerificationState> {
    const type = this.assertVerifiableType(entityType);
    const context = await this.loadContext(type, entityId);
    const verification = await this.findOrThrow(type, context.id);

    if (verification.status !== 'requested') {
      throw new BadRequestException({
        message: 'Solo se pueden aprobar solicitudes en revisión',
        currentStatus: verification.status,
      });
    }

    // The seal means Binntu checked the documents: every required one must be approved.
    const documents = await this.summarizeDocuments(type, context);
    if (documents.missing.length || documents.pendingReview.length || documents.rejected.length) {
      throw new BadRequestException({
        errorCode: 'VERIFICATION_DOCS_NOT_APPROVED',
        message: 'Aprueba todos los documentos requeridos antes de otorgar el sello',
        missing: documents.missing,
        pendingReview: documents.pendingReview,
        rejected: documents.rejected,
      });
    }

    const now = new Date();
    verification.status = 'verified';
    verification.verifiedAt = now;
    verification.reviewedAt = now;
    verification.reviewedById = reviewer.id;
    verification.rejectionReason = null;
    await this.verificationRepository.save(verification);

    this.notifyOwner(type, context, {
      subject: '¡Tu negocio ya es verificado en Binntu!',
      title: 'Obtuviste el sello Verificado',
      intro: `Revisamos la información de "${context.name}" y ya muestra el sello ✓ Verificado en Binntu.`,
    });

    return this.getState(type, context.id);
  }

  async reject(entityType: string, entityId: string, reason: string, reviewer: User): Promise<VerificationState> {
    return this.close(entityType, entityId, reason, reviewer, 'requested', 'rejected');
  }

  async revoke(entityType: string, entityId: string, reason: string, reviewer: User): Promise<VerificationState> {
    return this.close(entityType, entityId, reason, reviewer, 'verified', 'revoked');
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * HELPERS
  // * ----------------------------------------------------------------------------------------------------------------

  private async close(
    entityType: string,
    entityId: string,
    reason: string,
    reviewer: User,
    from: VerificationStatus,
    to: 'rejected' | 'revoked',
  ): Promise<VerificationState> {
    const type = this.assertVerifiableType(entityType);
    const context = await this.loadContext(type, entityId);
    const verification = await this.findOrThrow(type, context.id);

    if (verification.status !== from) {
      throw new BadRequestException({
        message: `Solo se puede pasar de "${from}" a "${to}"`,
        currentStatus: verification.status,
      });
    }

    verification.status = to;
    verification.rejectionReason = reason;
    verification.reviewedAt = new Date();
    verification.reviewedById = reviewer.id;
    if (to === 'revoked') verification.verifiedAt = null;
    await this.verificationRepository.save(verification);

    this.notifyOwner(type, context, {
      subject:
        to === 'rejected'
          ? 'Tu solicitud de verificación necesita ajustes'
          : 'Retiramos el sello Verificado de tu negocio',
      title: to === 'rejected' ? 'Solicitud de verificación no aprobada' : 'Sello Verificado retirado',
      intro: `Motivo: ${reason}. Puedes actualizar tus documentos y volver a solicitar la verificación desde tu panel.`,
    });

    return this.getState(type, context.id);
  }

  private notifyOwner(
    type: VerificationEntityType,
    context: EntityContext,
    message: { subject: string; title: string; intro: string },
  ) {
    if (!context.ownerEmail) return;
    void this.resendService.sendOwnerNotification(context.ownerEmail, {
      ...message,
      rows: [['Negocio', context.name]],
      path: `/profile/${PROFILE_PATH[type]}/${context.id}/documents`,
      ctaLabel: 'Ver mi verificación',
    });
  }

  private async summarizeDocuments(
    type: VerificationEntityType,
    context: EntityContext,
  ): Promise<VerificationDocumentsSummary> {
    if (!context.townId) return { required: 0, uploaded: 0, approved: 0, missing: [], pendingReview: [], rejected: [] };

    const requirements = await this.documentService.getEntityDocumentStatus(
      context.townId,
      type as unknown as DocumentEntityType,
      context.id,
      context.categoryIds,
    );
    const required = requirements.filter(r => r.isRequired);
    const name = (r: (typeof required)[number]) => r.documentType.name;

    return {
      required: required.length,
      uploaded: required.filter(r => r.isUploaded && !r.isExpired).length,
      approved: required.filter(r => r.document?.status === DocumentStatus.APPROVED && !r.isExpired).length,
      missing: required.filter(r => !r.isUploaded || r.isExpired).map(name),
      pendingReview: required
        .filter(r => r.isUploaded && !r.isExpired && r.document?.status === DocumentStatus.PENDING)
        .map(name),
      rejected: required.filter(r => r.document?.status === DocumentStatus.REJECTED).map(name),
    };
  }

  private async loadContext(type: VerificationEntityType, entityId: string): Promise<EntityContext> {
    const rows: Array<{
      id: string;
      name: string;
      owner_email: string | null;
      whatsapp: string | null;
      town_id: string | null;
      category_ids: string[] | null;
    }> = await this.verificationRepository.manager.query(CONTEXT_QUERY[type], [entityId]);
    const row = rows[0];
    if (!row) throw new NotFoundException('Entidad no encontrada');

    return {
      id: row.id,
      name: row.name,
      ownerEmail: row.owner_email,
      whatsapp: row.whatsapp,
      townId: row.town_id,
      categoryIds: row.category_ids ?? [],
    };
  }

  private async findOrThrow(type: VerificationEntityType, entityId: string) {
    const verification = await this.verificationRepository.findOne({ where: { entityType: type, entityId } });
    if (!verification) throw new NotFoundException('No hay solicitud de verificación para este negocio');
    return verification;
  }

  private isVerifiableType(entityType: string): entityType is VerificationEntityType {
    return (VERIFICATION_ENTITY_TYPES as readonly string[]).includes(entityType);
  }

  private assertVerifiableType(entityType: string): VerificationEntityType {
    if (!this.isVerifiableType(entityType)) {
      throw new BadRequestException(`El tipo "${entityType}" no admite verificación`);
    }
    return entityType;
  }
}
