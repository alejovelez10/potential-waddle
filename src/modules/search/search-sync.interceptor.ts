import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, tap } from 'rxjs';

import type { ResolvedEntityAccess } from 'src/modules/common/guards/entity-access.guard';
import { SEARCH_SYNC_KEY, SEARCH_SYNC_SKIP_KEY, SearchSyncTarget } from './decorators/search-sync.decorator';
import { SearchSyncQueue } from './search-sync.queue';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Child EntityAccess types reindex their parent business. */
const CHILD_PARENT_KIND: Record<string, string> = {
  lodging_room_type: 'lodging',
  commerce_product: 'commerce',
};

/**
 * After a successful write, marks the affected catalog entities as dirty:
 *  1. Any route with `@EntityAccess` — uses the ids the guard resolved (slug-safe, DELETE-safe).
 *  2. Any route with `@SearchSync(...)` — approve/reject, SuperAdmin catalogs, reviews, etc.
 * Runs only on success (`tap`), never alters the response and never throws.
 */
@Injectable()
export class SearchSyncInterceptor implements NestInterceptor {
  private readonly logger = new Logger(SearchSyncInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly queue: SearchSyncQueue,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (!this.queue.enabled || context.getType() !== 'http') return next.handle();

    const request = context.switchToHttp().getRequest();
    if (READ_METHODS.has(request.method)) return next.handle();

    // A method-level @SearchSync wins over a class-level @SearchSyncSkip (e.g. towns: only the
    // update routes touch catalog data); a method-level @SearchSyncSkip always wins.
    const handler = context.getHandler();
    const controller = context.getClass();
    const handlerTargets = this.reflector.get<SearchSyncTarget[] | undefined>(SEARCH_SYNC_KEY, handler);
    const classTargets = this.reflector.get<SearchSyncTarget[] | undefined>(SEARCH_SYNC_KEY, controller);
    const skip =
      this.reflector.get<boolean>(SEARCH_SYNC_SKIP_KEY, handler) ||
      (!handlerTargets && this.reflector.get<boolean>(SEARCH_SYNC_SKIP_KEY, controller));
    if (skip) return next.handle();
    const explicit = [...(handlerTargets ?? []), ...(classTargets ?? [])];

    return next.handle().pipe(
      tap(response => {
        try {
          const access = request.entityAccess as ResolvedEntityAccess | undefined;
          if (access) this.markFromAccess(access);
          for (const target of explicit) this.markFromTarget(target, request, response);
        } catch (error) {
          this.logger.warn(`Could not mark search sync: ${(error as Error).message}`);
        }
      }),
    );
  }

  private markFromAccess(access: ResolvedEntityAccess) {
    const parentKind = CHILD_PARENT_KIND[access.entityType];
    if (parentKind) {
      this.queue.mark(parentKind, access.parentIds);
      return;
    }
    this.queue.mark(access.entityType, access.ids);
  }

  private markFromTarget(target: SearchSyncTarget, request: any, response: unknown) {
    const kind = target.type.startsWith('param:')
      ? request.params?.[target.type.slice(6)]
      : target.type.startsWith('body:')
        ? request.body?.[target.type.slice(5)]
        : target.type;

    const identifiers: unknown[] = [];
    if (target.param) identifiers.push(request.params?.[target.param]);
    if (target.bodyId) identifiers.push(request.body?.[target.bodyId]);
    if (target.bodyIds && Array.isArray(request.body?.[target.bodyIds]))
      identifiers.push(...request.body[target.bodyIds]);
    if (target.fromResponse) {
      const field = target.fromResponse === true ? 'id' : target.fromResponse;
      identifiers.push((response as Record<string, unknown> | null)?.[field]);
    }

    this.queue.mark(
      String(kind ?? ''),
      identifiers.map(id => (id === null || id === undefined ? null : String(id))),
    );
  }
}
