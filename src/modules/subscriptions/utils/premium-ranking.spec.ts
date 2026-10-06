import { findPagePremiumFirst, shouldRankPremiumFirst, sortPremiumFirst } from './premium-ranking';

describe('premium-ranking (freemium)', () => {
  it('ranks Premium first only on the default ordering', () => {
    expect(shouldRankPremiumFirst(undefined)).toBe(true);
    expect(shouldRankPremiumFirst('random')).toBe(true);
    expect(shouldRankPremiumFirst('name')).toBe(false);
    expect(shouldRankPremiumFirst('-rating')).toBe(false);
  });

  it('sortPremiumFirst is a stable partition', () => {
    const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
    expect(sortPremiumFirst(items, new Set(['c', 'a'])).map(i => i.id)).toEqual(['a', 'c', 'b', 'd']);
    expect(sortPremiumFirst(items, new Set()).map(i => i.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('findPagePremiumFirst ranks the whole result set before slicing the page', async () => {
    const all = ['a', 'b', 'c', 'd', 'e'].map(id => ({ id }));
    const repository = {
      find: jest
        .fn()
        // 1st call: ids of every match, DB order
        .mockResolvedValueOnce(all)
        // 2nd call: the page entities (DB returns them unordered)
        .mockImplementationOnce(async ({ where }) => where.id._value.map((id: string) => ({ id })).reverse()),
    };

    const [page, count] = await findPagePremiumFirst(
      repository as any,
      { skip: 0, take: 2, where: {} },
      new Set(['e', 'c']),
    );

    expect(count).toBe(5);
    expect(page.map(i => i.id)).toEqual(['c', 'e']);
  });
});
