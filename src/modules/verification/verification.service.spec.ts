import { BadRequestException } from '@nestjs/common';
import { DocumentStatus } from '../documents/enums';
import { VerificationService } from './verification.service';

const ENTITY_ID = '11111111-1111-4111-8111-111111111111';
const CONTEXT_ROW = {
  id: ENTITY_ID,
  name: 'Finca La Montaña',
  owner_email: 'owner@test.co',
  whatsapp: '573000000000',
  town_id: 'town-1',
  category_ids: ['cat-1'],
};
const ADMIN = { id: 'admin-1', isSuperUser: true } as any;

const requirement = (
  name: string,
  opts: { required?: boolean; status?: DocumentStatus | null; expired?: boolean },
) => ({
  documentType: { id: name, name },
  isRequired: opts.required ?? true,
  isUploaded: opts.status !== null && opts.status !== undefined,
  isExpired: !!opts.expired,
  document: opts.status ? { status: opts.status } : null,
});

describe('VerificationService (freemium — Verified seal)', () => {
  let service: VerificationService;
  let repository: {
    findOne: jest.Mock;
    find: jest.Mock;
    exist: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    manager: { query: jest.Mock };
  };
  let documentService: { getEntityDocumentStatus: jest.Mock };
  let resend: { sendAdminNotification: jest.Mock; sendOwnerNotification: jest.Mock };

  beforeEach(() => {
    repository = {
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockResolvedValue([]),
      exist: jest.fn(),
      create: jest.fn().mockImplementation(data => ({ ...data })),
      save: jest.fn().mockImplementation(async data => data),
      manager: { query: jest.fn().mockResolvedValue([CONTEXT_ROW]) },
    };
    documentService = { getEntityDocumentStatus: jest.fn().mockResolvedValue([]) };
    resend = {
      sendAdminNotification: jest.fn().mockResolvedValue(true),
      sendOwnerNotification: jest.fn().mockResolvedValue(true),
    };
    service = new VerificationService(repository as any, documentService as any, resend as any);
  });

  it('rejects entity types that cannot be verified (places, experiences)', async () => {
    await expect(service.getState('place', ENTITY_ID)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.request('experience', ENTITY_ID)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('getState: no request yet, required docs uploaded → canRequest', async () => {
    documentService.getEntityDocumentStatus.mockResolvedValue([
      requirement('RUT', { status: DocumentStatus.PENDING }),
      requirement('Cámara de comercio', { required: false, status: null }),
    ]);

    const state = await service.getState('lodging', ENTITY_ID);

    expect(state.status).toBe('none');
    expect(state.canRequest).toBe(true);
    expect(state.documents).toMatchObject({
      required: 1,
      uploaded: 1,
      approved: 0,
      missing: [],
      pendingReview: ['RUT'],
    });
    // document requirements are resolved with the business town + categories
    expect(documentService.getEntityDocumentStatus).toHaveBeenCalledWith('town-1', 'lodging', ENTITY_ID, ['cat-1']);
  });

  it('request: missing required documents → VERIFICATION_DOCS_INCOMPLETE and nothing is saved', async () => {
    documentService.getEntityDocumentStatus.mockResolvedValue([
      requirement('RUT', { status: DocumentStatus.PENDING }),
      requirement('Cédula', { status: null }),
    ]);

    await expect(service.request('lodging', ENTITY_ID)).rejects.toMatchObject({
      response: expect.objectContaining({ errorCode: 'VERIFICATION_DOCS_INCOMPLETE', missing: ['Cédula'] }),
    });
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('request: town without verification requirements → VERIFICATION_NOT_CONFIGURED', async () => {
    await expect(service.request('lodging', ENTITY_ID)).rejects.toMatchObject({
      response: expect.objectContaining({ errorCode: 'VERIFICATION_NOT_CONFIGURED' }),
    });
  });

  it('request: happy path saves "requested" and alerts the Binntu team', async () => {
    documentService.getEntityDocumentStatus.mockResolvedValue([requirement('RUT', { status: DocumentStatus.PENDING })]);

    await service.request('commerce', ENTITY_ID);

    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'commerce',
        entityId: ENTITY_ID,
        status: 'requested',
        rejectionReason: null,
      }),
    );
    expect(resend.sendAdminNotification).toHaveBeenCalledWith(
      expect.objectContaining({ subject: expect.stringContaining('Finca La Montaña') }),
    );
  });

  it('request: already verified → VERIFICATION_ALREADY_VERIFIED', async () => {
    repository.findOne.mockResolvedValue({ status: 'verified' });
    documentService.getEntityDocumentStatus.mockResolvedValue([
      requirement('RUT', { status: DocumentStatus.APPROVED }),
    ]);

    await expect(service.request('lodging', ENTITY_ID)).rejects.toMatchObject({
      response: expect.objectContaining({ errorCode: 'VERIFICATION_ALREADY_VERIFIED' }),
    });
  });

  it('approve: refuses while a required document is not approved yet', async () => {
    repository.findOne.mockResolvedValue({ status: 'requested' });
    documentService.getEntityDocumentStatus.mockResolvedValue([
      requirement('RUT', { status: DocumentStatus.APPROVED }),
      requirement('Cédula', { status: DocumentStatus.PENDING }),
    ]);

    await expect(service.approve('lodging', ENTITY_ID, ADMIN)).rejects.toMatchObject({
      response: expect.objectContaining({ errorCode: 'VERIFICATION_DOCS_NOT_APPROVED', pendingReview: ['Cédula'] }),
    });
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('approve: every required document approved → verified + owner notified', async () => {
    const row = { status: 'requested' } as any;
    repository.findOne.mockResolvedValue(row);
    documentService.getEntityDocumentStatus.mockResolvedValue([
      requirement('RUT', { status: DocumentStatus.APPROVED }),
    ]);

    await service.approve('lodging', ENTITY_ID, ADMIN);

    expect(row).toMatchObject({ status: 'verified', reviewedById: 'admin-1', rejectionReason: null });
    expect(row.verifiedAt).toBeInstanceOf(Date);
    expect(resend.sendOwnerNotification).toHaveBeenCalledWith('owner@test.co', expect.anything());
  });

  it('reject only applies to requests in review; revoke only to granted seals', async () => {
    repository.findOne.mockResolvedValue({ status: 'verified' });
    await expect(service.reject('lodging', ENTITY_ID, 'x', ADMIN)).rejects.toBeInstanceOf(BadRequestException);

    const row = { status: 'verified', verifiedAt: new Date() } as any;
    repository.findOne.mockResolvedValue(row);
    await service.revoke('lodging', ENTITY_ID, 'Documento vencido', ADMIN);
    expect(row).toMatchObject({ status: 'revoked', rejectionReason: 'Documento vencido', verifiedAt: null });
  });

  it('getVerifiedIdSet: experiences inherit the seal from their guide', async () => {
    repository.manager.query.mockResolvedValueOnce([{ id: 'exp-1' }]);
    await expect(service.getVerifiedIdSet('experience')).resolves.toEqual(new Set(['exp-1']));
    await expect(service.getVerifiedIdSet('place')).resolves.toEqual(new Set());
  });
});
