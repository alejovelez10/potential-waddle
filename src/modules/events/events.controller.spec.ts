// BIZ-08 controller wiring: the analytics route asserts ownership BEFORE querying.
//   - owner -> 200 with the documented shape
//   - non-owner -> 403 (the resolver throws; the controller must surface it, NOT swallow it)
//   - assertCanRead is called BEFORE getEntityAnalytics (gate ordering)
// 401 (no Bearer) and 400 (bad enum) are enforced by @Auth() + the global ValidationPipe and are
// covered at the e2e/pipe layer; here we assert the controller's own gate logic.
import { ForbiddenException } from '@nestjs/common';
import { EventsController } from './events.controller';

describe('EventsController.getEntityAnalytics (BIZ-08 — IDOR gate)', () => {
  let controller: EventsController;
  let ownership: { assertCanRead: jest.Mock };
  let analytics: { getEntityAnalytics: jest.Mock };
  let subscriptions: { assertPremium: jest.Mock };

  const OWNER = { id: 'user-owner' } as any;
  const NON_OWNER = { id: 'user-other' } as any;
  const QUERY = { entityType: 'lodging', entityId: 'l-1' } as any;
  const SHAPE = { summary: {}, deltas: {}, trend: [], byCity: [], byChannel: {}, range: {} };

  beforeEach(() => {
    ownership = { assertCanRead: jest.fn() };
    analytics = { getEntityAnalytics: jest.fn().mockResolvedValue(SHAPE) };
    subscriptions = { assertPremium: jest.fn().mockResolvedValue(undefined) };
    controller = new EventsController({} as any, ownership as any, analytics as any, {} as any, subscriptions as any);
  });

  it('owner -> 200 with summary/deltas/trend/byCity/byChannel keys', async () => {
    ownership.assertCanRead.mockResolvedValueOnce({ townId: 'town-1' });
    const res = await controller.getEntityAnalytics(QUERY, OWNER);
    expect(res).toEqual(SHAPE);
    expect(analytics.getEntityAnalytics).toHaveBeenCalledWith({ ...QUERY, townId: 'town-1' });
  });

  it('non-owner -> ForbiddenException (403) and the query is NEVER run', async () => {
    ownership.assertCanRead.mockRejectedValueOnce(new ForbiddenException());
    await expect(controller.getEntityAnalytics(QUERY, NON_OWNER)).rejects.toBeInstanceOf(ForbiddenException);
    expect(analytics.getEntityAnalytics).not.toHaveBeenCalled();
  });

  it('asserts ownership BEFORE querying analytics (gate ordering)', async () => {
    const order: string[] = [];
    ownership.assertCanRead.mockImplementationOnce(async () => {
      order.push('assertCanRead');
      return { townId: 'town-1' };
    });
    analytics.getEntityAnalytics.mockImplementationOnce(async () => {
      order.push('getEntityAnalytics');
      return SHAPE;
    });
    await controller.getEntityAnalytics(QUERY, OWNER);
    expect(order).toEqual(['assertCanRead', 'getEntityAnalytics']);
  });

  it('freemium: a non-Premium owner gets 403 PREMIUM_REQUIRED and the query is NEVER run', async () => {
    ownership.assertCanRead.mockResolvedValueOnce({ townId: 'town-1' });
    subscriptions.assertPremium.mockRejectedValueOnce(new ForbiddenException({ errorCode: 'PREMIUM_REQUIRED' }));
    await expect(controller.getEntityAnalytics(QUERY, OWNER)).rejects.toBeInstanceOf(ForbiddenException);
    expect(subscriptions.assertPremium).toHaveBeenCalledWith('lodging', 'l-1', 'analytics');
    expect(analytics.getEntityAnalytics).not.toHaveBeenCalled();
  });

  it('freemium: super-admins and town-admins of the entity town skip the Premium check', async () => {
    const SUPER = { id: 'u-super', isSuperUser: true, towns: [] } as any;
    const TOWN_ADMIN = { id: 'u-ta', isSuperUser: false, towns: [{ id: 'town-1' }] } as any;

    ownership.assertCanRead.mockResolvedValueOnce({ townId: 'town-9' });
    await controller.getEntityAnalytics(QUERY, SUPER);
    ownership.assertCanRead.mockResolvedValueOnce({ townId: 'town-1' });
    await controller.getEntityAnalytics(QUERY, TOWN_ADMIN);

    expect(subscriptions.assertPremium).not.toHaveBeenCalled();
    expect(analytics.getEntityAnalytics).toHaveBeenCalledTimes(2);
  });
});

// ------------------------------------------------------------------------------------------------
// PLAT-04 controller wiring: resolvePlatformScope (the IDOR gate) runs BEFORE the query.
//   - town-admin with town='other' -> service called with townIds forced to OWN town (not other)
//   - super-admin, no town -> service called with townIds null (all towns)
//   - non-super with no towns -> ForbiddenException; the service is NEVER called
// ------------------------------------------------------------------------------------------------
describe('EventsController.getPlatformAnalytics (PLAT-04 — IDOR gate)', () => {
  let controller: EventsController;
  let platform: { getPlatformAnalytics: jest.Mock };

  const SHAPE = { range: {}, topSearches: [], zeroResultSearches: [], traffic: [], topEntities: [], funnel: [] };

  beforeEach(() => {
    platform = { getPlatformAnalytics: jest.fn().mockResolvedValue(SHAPE) };
    // positional ctor: (events, ownership, entityAnalytics, platformAnalytics, subscriptions)
    controller = new EventsController({} as any, {} as any, {} as any, platform as any, {} as any);
  });

  it('town-admin passing town=town-2 -> service receives townIds [town-1] (forced own town, IDOR)', async () => {
    const TOWN_ADMIN = { id: 'u-ta', isSuperUser: false, towns: [{ id: 'town-1' }] } as any;
    await controller.getPlatformAnalytics({ town: 'town-2' } as any, TOWN_ADMIN);
    expect(platform.getPlatformAnalytics).toHaveBeenCalledWith(
      expect.objectContaining({ townIds: ['town-1'], resolveSlug: false }),
    );
    // the other town's id must never reach the service.
    const arg = platform.getPlatformAnalytics.mock.calls[0][0];
    expect(arg.townIds).not.toContain('town-2');
  });

  it('super-admin with no town -> service receives townIds null (all towns)', async () => {
    const SUPER = { id: 'u-super', isSuperUser: true, towns: [] } as any;
    await controller.getPlatformAnalytics({} as any, SUPER);
    expect(platform.getPlatformAnalytics).toHaveBeenCalledWith(expect.objectContaining({ townIds: null }));
  });

  it('non-super with no towns -> ForbiddenException; the service is NEVER called', async () => {
    const NO_TOWNS = { id: 'u-x', isSuperUser: false, towns: [] } as any;
    await expect(controller.getPlatformAnalytics({} as any, NO_TOWNS)).rejects.toBeInstanceOf(ForbiddenException);
    expect(platform.getPlatformAnalytics).not.toHaveBeenCalled();
  });
});
