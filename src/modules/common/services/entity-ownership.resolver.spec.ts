// BIZ-08 / T-17-01/02: the IDOR gate. Unit-tested against a mocked DataSource.
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { EntityOwnershipResolver } from './entity-ownership.resolver';

const ID_1 = '11111111-1111-4111-8111-111111111111';
const ID_2 = '22222222-2222-4222-8222-222222222222';

describe('EntityOwnershipResolver (ownership / IDOR — T-17-01/02)', () => {
  let resolver: EntityOwnershipResolver;
  let dataSource: { query: jest.Mock };

  const OWNER = { id: 'user-owner', isSuperUser: false, towns: [] } as any;
  const OTHER = { id: 'user-other', isSuperUser: false, towns: [] } as any;
  const SUPER = { id: 'user-super', isSuperUser: true, towns: [] } as any;
  const TOWN_ADMIN = { id: 'user-ta', isSuperUser: false, towns: [{ id: 'town-1' }] } as any;

  beforeEach(() => {
    dataSource = { query: jest.fn() };
    resolver = new EntityOwnershipResolver(dataSource as any);
  });

  describe('assertCanRead', () => {
    it('resolves (no throw) for the owner of a lodging', async () => {
      dataSource.query.mockResolvedValueOnce([{ user_id: 'user-owner', town_id: 'town-1' }]);
      await expect(resolver.assertCanRead('lodging', ID_1, OWNER)).resolves.toEqual({ townId: 'town-1' });
    });

    it('throws ForbiddenException for a non-owner / non-admin (cross-owner IDOR -> 403)', async () => {
      dataSource.query.mockResolvedValueOnce([{ user_id: 'user-owner', town_id: 'town-1' }]);
      await expect(resolver.assertCanRead('lodging', ID_1, OTHER)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('resolves for a super-admin on any entity', async () => {
      dataSource.query.mockResolvedValueOnce([{ user_id: 'someone-else', town_id: 'town-9' }]);
      await expect(resolver.assertCanRead('lodging', ID_1, SUPER)).resolves.toEqual({ townId: 'town-9' });
    });

    it('resolves for a town-admin of the entity town; throws for a different town', async () => {
      dataSource.query.mockResolvedValueOnce([{ user_id: 'user-owner', town_id: 'town-1' }]);
      await expect(resolver.assertCanRead('restaurant', ID_1, TOWN_ADMIN)).resolves.toEqual({ townId: 'town-1' });

      dataSource.query.mockResolvedValueOnce([{ user_id: 'user-owner', town_id: 'town-2' }]);
      await expect(resolver.assertCanRead('restaurant', ID_2, TOWN_ADMIN)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('place (no owner): only town-admin of its town or super resolves; a plain user throws', async () => {
      dataSource.query.mockResolvedValueOnce([{ user_id: null, town_id: 'town-1' }]);
      await expect(resolver.assertCanRead('place', ID_1, TOWN_ADMIN)).resolves.toEqual({ townId: 'town-1' });

      dataSource.query.mockResolvedValueOnce([{ user_id: null, town_id: 'town-1' }]);
      await expect(resolver.assertCanRead('place', ID_1, OTHER)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('experience: owner is the experience guide owner (experience.guide.user_id)', async () => {
      dataSource.query.mockResolvedValueOnce([{ user_id: 'user-owner', town_id: 'town-1' }]);
      await expect(resolver.assertCanRead('experience', ID_1, OWNER)).resolves.toEqual({ townId: 'town-1' });
    });

    it('guide: town comes from guide_town; town-admin of a guide town resolves', async () => {
      // first query: guide row (user_id only, no town_id column)
      dataSource.query.mockResolvedValueOnce([{ id: ID_1, user_id: 'user-owner', town_id: null }]);
      // second query: guide_town rows
      dataSource.query.mockResolvedValueOnce([{ town_id: 'town-1' }, { town_id: 'town-3' }]);
      await expect(resolver.assertCanRead('guide', ID_1, TOWN_ADMIN)).resolves.toEqual({ townId: 'town-1' });
    });

    it('throws NotFoundException when the entity row does not exist', async () => {
      dataSource.query.mockResolvedValueOnce([]);
      await expect(resolver.assertCanRead('lodging', ID_1, OWNER)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects an unknown entityType (whitelist guard — no SQL injection)', async () => {
      await expect(resolver.assertCanRead('robots; DROP TABLE', ID_1, OWNER)).rejects.toBeInstanceOf(NotFoundException);
      expect(dataSource.query).not.toHaveBeenCalled();
    });

    it('rejects a non-uuid id without querying for types with no slug (avoids a Postgres 500)', async () => {
      await expect(resolver.assertCanRead('transport', 'not-a-uuid', OWNER)).rejects.toBeInstanceOf(NotFoundException);
      expect(dataSource.query).not.toHaveBeenCalled();
    });

    it('resolves slug-addressed types by slug (e.g. PATCH /guides/:slug)', async () => {
      dataSource.query.mockResolvedValueOnce([{ id: ID_1, user_id: 'user-owner', town_id: null }]);
      dataSource.query.mockResolvedValueOnce([{ town_id: 'town-1' }]);
      await expect(resolver.assertCanManage('guide', 'juan-perez', OWNER)).resolves.toEqual({ townId: 'town-1' });
      expect(dataSource.query.mock.calls[0][0]).toContain('slug = $1');
      // guide towns are resolved with the real id, not the slug
      expect(dataSource.query.mock.calls[1][1]).toEqual([ID_1]);
    });

    it('nested types resolve the owner through the parent business', async () => {
      dataSource.query.mockResolvedValueOnce([{ id: ID_2, user_id: 'user-owner', town_id: 'town-1' }]);
      await expect(resolver.assertCanManage('lodging_room_type', ID_2, OWNER)).resolves.toEqual({ townId: 'town-1' });
      expect(dataSource.query.mock.calls[0][0]).toContain('JOIN "lodging"');
    });
  });

  describe('assertCanManage', () => {
    it('allows the owner and rejects a stranger', async () => {
      dataSource.query.mockResolvedValueOnce([{ user_id: 'user-owner', town_id: 'town-1' }]);
      await expect(resolver.assertCanManage('commerce', ID_1, OWNER)).resolves.toEqual({ townId: 'town-1' });

      dataSource.query.mockResolvedValueOnce([{ user_id: 'user-owner', town_id: 'town-1' }]);
      await expect(resolver.assertCanManage('commerce', ID_1, OTHER)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('assertCanModerate', () => {
    it('rejects the owner — owners cannot approve their own business', async () => {
      dataSource.query.mockResolvedValueOnce([{ user_id: 'user-owner', town_id: 'town-1' }]);
      await expect(resolver.assertCanModerate('restaurant', ID_1, OWNER)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows a super-admin and a town-admin of the entity town', async () => {
      dataSource.query.mockResolvedValueOnce([{ user_id: 'user-owner', town_id: 'town-9' }]);
      await expect(resolver.assertCanModerate('restaurant', ID_1, SUPER)).resolves.toEqual({ townId: 'town-9' });

      dataSource.query.mockResolvedValueOnce([{ user_id: 'user-owner', town_id: 'town-1' }]);
      await expect(resolver.assertCanModerate('transport', ID_1, TOWN_ADMIN)).resolves.toEqual({ townId: 'town-1' });
    });

    it('rejects a town-admin of a different town', async () => {
      dataSource.query.mockResolvedValueOnce([{ user_id: 'user-owner', town_id: 'town-2' }]);
      await expect(resolver.assertCanModerate('commerce', ID_1, TOWN_ADMIN)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
