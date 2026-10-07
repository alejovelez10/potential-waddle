import { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, of } from 'rxjs';

import { SEARCH_SYNC_KEY, SEARCH_SYNC_SKIP_KEY } from './decorators/search-sync.decorator';
import { SearchSyncInterceptor } from './search-sync.interceptor';
import { SearchSyncQueue, toDirtyKind } from './search-sync.queue';

function makeQueue(algolia: Record<string, unknown>) {
  const config = { get: () => algolia } as never;
  return new SearchSyncQueue(config);
}

const PROD = { appId: 'APP', adminApiKey: 'KEY', syncEnabled: true };

describe('SearchSyncQueue', () => {
  afterEach(() => jest.useRealTimers());

  it('is a no-op in safe mode (no admin key or sync disabled)', async () => {
    for (const algolia of [{ ...PROD, adminApiKey: '' }, { ...PROD, syncEnabled: false }, {}]) {
      const queue = makeQueue(algolia);
      const handler = jest.fn().mockResolvedValue(undefined);
      queue.registerHandler(handler);
      queue.mark('lodging', 'id-1');
      await queue.flush();
      expect(queue.enabled).toBe(false);
      expect(handler).not.toHaveBeenCalled();
    }
  });

  it('coalesces marks per kind and flushes them once', async () => {
    const queue = makeQueue(PROD);
    const handler = jest.fn().mockResolvedValue(undefined);
    queue.registerHandler(handler);

    queue.mark('lodging', 'a');
    queue.mark('lodgings', ['a', 'b', null]);
    queue.mark('public_event', 'e1');
    queue.mark('not-a-catalog-type', 'zzz');
    await queue.flush();

    expect(handler).toHaveBeenCalledTimes(1);
    const batch = handler.mock.calls[0][0] as Map<string, string[]>;
    expect(batch.get('lodging')).toEqual(['a', 'b']);
    expect(batch.get('event')).toEqual(['e1']);
    expect(batch.size).toBe(2);
    await queue.onModuleDestroy();
  });

  it('flushes automatically after the debounce delay', async () => {
    jest.useFakeTimers();
    const queue = makeQueue(PROD);
    const handler = jest.fn().mockResolvedValue(undefined);
    queue.registerHandler(handler);
    queue.mark('guide', 'g1');
    expect(handler).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(2100);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('normalizes entity-type spellings', () => {
    expect(toDirtyKind('experiences')).toBe('experience');
    expect(toDirtyKind('category')).toBe('category');
    expect(toDirtyKind('roomType')).toBeNull();
    expect(toDirtyKind(undefined)).toBeNull();
  });
});

describe('SearchSyncInterceptor', () => {
  function run(request: Record<string, unknown>, metadata: Record<string, unknown> = {}, response: unknown = {}) {
    const queue = makeQueue(PROD);
    const mark = jest.spyOn(queue, 'mark');
    const handlerFn = () => undefined;
    const reflector = {
      get: (key: string, target: unknown) => (target === handlerFn ? metadata[key] : undefined),
    } as unknown as Reflector;
    const interceptor = new SearchSyncInterceptor(reflector, queue);
    const context = {
      getType: () => 'http',
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => handlerFn,
      getClass: () => class {},
    } as unknown as ExecutionContext;
    const next: CallHandler = { handle: () => of(response) };
    return { mark, done: lastValueFrom(interceptor.intercept(context, next)) };
  }

  it('marks the ids resolved by EntityAccess after a write', async () => {
    const { mark, done } = run({
      method: 'PATCH',
      entityAccess: { entityType: 'lodging', ids: ['l1'], parentIds: [] },
    });
    await done;
    expect(mark).toHaveBeenCalledWith('lodging', ['l1']);
  });

  it('maps child types to their parent business', async () => {
    const { mark, done } = run({
      method: 'DELETE',
      entityAccess: { entityType: 'lodging_room_type', ids: ['rt1'], parentIds: ['l9'] },
    });
    await done;
    expect(mark).toHaveBeenCalledWith('lodging', ['l9']);
  });

  it('resolves explicit @SearchSync targets from params, body and response', async () => {
    const { mark, done } = run(
      { method: 'POST', params: { entityType: 'guide', entityId: 'g1' }, body: { ids: ['x', 'y'] } },
      {
        [SEARCH_SYNC_KEY]: [
          { type: 'param:entityType', param: 'entityId' },
          { type: 'restaurant', bodyIds: 'ids' },
          { type: 'place', fromResponse: true },
        ],
      },
      { id: 'p1' },
    );
    await done;
    expect(mark).toHaveBeenCalledWith('guide', ['g1']);
    expect(mark).toHaveBeenCalledWith('restaurant', ['x', 'y']);
    expect(mark).toHaveBeenCalledWith('place', ['p1']);
  });

  it('ignores reads and skipped routes', async () => {
    const read = run({ method: 'GET', entityAccess: { entityType: 'lodging', ids: ['l1'], parentIds: [] } });
    await read.done;
    expect(read.mark).not.toHaveBeenCalled();

    const skipped = run(
      { method: 'POST', entityAccess: { entityType: 'lodging', ids: ['l1'], parentIds: [] } },
      { [SEARCH_SYNC_SKIP_KEY]: true },
    );
    await skipped.done;
    expect(skipped.mark).not.toHaveBeenCalled();
  });
});
