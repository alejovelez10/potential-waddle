import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';

const ENTITY_ID = '11111111-1111-4111-8111-111111111111';
const PLAN = {
  id: 'plan-pro',
  name: 'Premium Negocios',
  priceInCents: 9990000,
  billingInterval: 'yearly',
  isActive: true,
  entityTypes: ['lodging', 'restaurant', 'commerce', 'guide'],
};
const USER = { id: 'user-1', isSuperUser: false, towns: [] } as any;
const item = (overrides: Record<string, unknown> = {}) => ({
  planId: PLAN.id,
  entityType: 'lodging',
  entityId: ENTITY_ID,
  entityName: 'Finca La Montaña',
  ...overrides,
});

describe('SubscriptionsService — freemium checkout & activation', () => {
  let service: SubscriptionsService;
  let subscriptionRepository: Record<string, any>;
  let planRepository: { find: jest.Mock };
  let paymentsService: { generateReference: jest.Mock; create: jest.Mock };
  let ownership: { assertCanManage: jest.Mock };
  let resend: { sendAdminNotification: jest.Mock; sendOwnerNotification: jest.Mock };
  let entityStatus: string;

  beforeEach(() => {
    entityStatus = 'published';
    subscriptionRepository = {
      findOne: jest.fn().mockResolvedValue(null), // no active subscription
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation(data => ({ ...data })),
      save: jest.fn().mockImplementation(async data => data),
      manager: { query: jest.fn().mockImplementation(async () => [{ status: entityStatus }]) },
    };
    planRepository = { find: jest.fn().mockResolvedValue([PLAN]) };
    paymentsService = {
      generateReference: jest.fn().mockReturnValue('BINNTU-PAY-1'),
      create: jest.fn().mockResolvedValue({ id: 'payment-1' }),
    };
    ownership = { assertCanManage: jest.fn().mockResolvedValue({ townId: 'town-1' }) };
    resend = {
      sendAdminNotification: jest.fn().mockResolvedValue(true),
      sendOwnerNotification: jest.fn().mockResolvedValue(true),
    };
    const config = { get: jest.fn().mockReturnValue('x') };

    service = new SubscriptionsService(
      subscriptionRepository as any,
      planRepository as any,
      {} as any,
      paymentsService as any,
      config as any,
      ownership as any,
      resend as any,
      { mark: jest.fn() } as any,
    );
  });

  describe('createCheckout', () => {
    it('computes the period server-side (+1 year) and ignores any client dates', async () => {
      const before = Date.now();
      await service.createCheckout(USER, { items: [item({ endDate: '2099-12-31' })] } as any);

      const saved = subscriptionRepository.save.mock.calls[0][0];
      const years = (saved.currentPeriodEnd.getTime() - saved.currentPeriodStart.getTime()) / (365 * 24 * 3600 * 1000);
      expect(years).toBeGreaterThan(0.99);
      expect(years).toBeLessThan(1.01);
      expect(saved.currentPeriodStart.getTime()).toBeGreaterThanOrEqual(before);
      expect(saved).toMatchObject({ status: 'pending', assistanceStatus: 'none', assistedOnboarding: false });
    });

    it('rejects a business the caller does not own', async () => {
      ownership.assertCanManage.mockRejectedValueOnce(new ForbiddenException());
      await expect(service.createCheckout(USER, { items: [item()] } as any)).rejects.toBeInstanceOf(ForbiddenException);
      expect(paymentsService.create).not.toHaveBeenCalled();
    });

    it('approval first: a draft cannot pay Premium (APPROVAL_REQUIRED)…', async () => {
      entityStatus = 'draft';
      await expect(service.createCheckout(USER, { items: [item()] } as any)).rejects.toMatchObject({
        response: expect.objectContaining({ errorCode: 'APPROVAL_REQUIRED', currentStatus: 'draft' }),
      });
      expect(paymentsService.create).not.toHaveBeenCalled();
    });

    it('…except through the "Registro asistido Premium" path', async () => {
      entityStatus = 'draft';
      await service.createCheckout(USER, { items: [item({ assisted: true })] } as any);
      expect(subscriptionRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ assistedOnboarding: true, assistanceStatus: 'none' }),
      );
    });

    it('rejects inactive plans and plans for another entity type', async () => {
      planRepository.find.mockResolvedValueOnce([{ ...PLAN, isActive: false }]);
      await expect(service.createCheckout(USER, { items: [item()] } as any)).rejects.toBeInstanceOf(
        BadRequestException,
      );

      planRepository.find.mockResolvedValueOnce([PLAN]);
      await expect(
        service.createCheckout(USER, { items: [item({ entityType: 'transport' })] } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects the same business twice in one cart', async () => {
      await expect(service.createCheckout(USER, { items: [item(), item()] } as any)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('activateSubscriptionsByPayment', () => {
    it('activates pending subscriptions and notifies admin + owner once (idempotent on webhook retries)', async () => {
      const pending = {
        status: 'pending',
        assistanceStatus: 'none',
        assistedOnboarding: true,
        entityType: 'lodging',
        entityId: ENTITY_ID,
        entityName: 'Finca La Montaña',
        user: { email: 'owner@test.co' },
        plan: { name: 'Premium Negocios' },
      };
      subscriptionRepository.find.mockResolvedValue([pending]);

      await service.activateSubscriptionsByPayment('payment-1');
      expect(pending.status).toBe('active');
      expect(pending.assistanceStatus).toBe('pending'); // enters the follow-up queue only once paid
      expect(resend.sendAdminNotification).toHaveBeenCalledTimes(1);
      expect(resend.sendOwnerNotification).toHaveBeenCalledWith('owner@test.co', expect.anything());

      // Wompi retries the webhook: already active → no new emails
      await service.activateSubscriptionsByPayment('payment-1');
      expect(resend.sendAdminNotification).toHaveBeenCalledTimes(1);
    });
  });

  describe('assertPhotoCapacity', () => {
    it('free plan: 10 photos, then 403 PREMIUM_REQUIRED', async () => {
      jest.spyOn(service, 'isPremium').mockResolvedValue(false);
      await expect(service.assertPhotoCapacity('lodging', ENTITY_ID, 8, 2)).resolves.toBeUndefined();
      await expect(service.assertPhotoCapacity('lodging', ENTITY_ID, 9, 2)).rejects.toMatchObject({
        response: expect.objectContaining({ errorCode: 'PREMIUM_REQUIRED', limit: 10 }),
      });
    });

    it('premium: 30 photos, then 403 PHOTO_LIMIT_REACHED', async () => {
      jest.spyOn(service, 'isPremium').mockResolvedValue(true);
      await expect(service.assertPhotoCapacity('lodging', ENTITY_ID, 25, 5)).resolves.toBeUndefined();
      await expect(service.assertPhotoCapacity('lodging', ENTITY_ID, 30, 1)).rejects.toMatchObject({
        response: expect.objectContaining({ errorCode: 'PHOTO_LIMIT_REACHED', limit: 30 }),
      });
    });
  });
});
