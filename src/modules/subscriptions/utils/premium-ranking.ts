import { FindManyOptions, FindOptionsWhere, In, ObjectLiteral, Repository } from 'typeorm';

/**
 * Premium ranking (freemium 2026-10): Premium businesses get more exposure in public lists.
 *
 * It only applies to the default ordering (no `sortBy`, or `sortBy=random`, which is what the
 * frontend sends by default). An explicit sort chosen by the traveler (name, rating, price…) is
 * always respected.
 */
export function shouldRankPremiumFirst(sortBy?: string | null): boolean {
  return !sortBy || sortBy === 'random';
}

/** Stable partition: Premium items first, each group keeps its incoming order. */
export function sortPremiumFirst<T extends { id: string | number }>(items: T[], premiumIds: Set<string>): T[] {
  const premium: T[] = [];
  const rest: T[] = [];
  for (const item of items) (premiumIds.has(String(item.id)) ? premium : rest).push(item);
  return [...premium, ...rest];
}

/**
 * Paginated variant of {@link sortPremiumFirst}: ranks the WHOLE result set (ids only) before
 * slicing the page, so Premium items land on the first pages instead of being reordered inside
 * whatever page the database returned.
 */
export async function findPagePremiumFirst<T extends ObjectLiteral & { id: string }>(
  repository: Repository<T>,
  options: Omit<FindManyOptions<T>, 'skip' | 'take' | 'select'> & { skip: number; take: number },
  premiumIds: Set<string>,
): Promise<[T[], number]> {
  const { skip, take, relations, ...rest } = options;

  const matches = await repository.find({ ...rest, select: { id: true } as FindManyOptions<T>['select'] });
  const rankedIds = sortPremiumFirst(matches, premiumIds).map(match => match.id);
  const pageIds = rankedIds.slice(skip, skip + take);
  if (pageIds.length === 0) return [[], rankedIds.length];

  const pageItems = await repository.find({
    relations,
    order: rest.order,
    where: { id: In(pageIds) } as FindOptionsWhere<T>,
  });
  const position = new Map(pageIds.map((id, index) => [id, index]));
  pageItems.sort((a, b) => (position.get(a.id) ?? 0) - (position.get(b.id) ?? 0));

  return [pageItems, rankedIds.length];
}
