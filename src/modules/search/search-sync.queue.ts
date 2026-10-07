import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { EnvironmentVariables } from 'src/config';
import { isSearchType, SearchType } from './search.constants';

/** Search types + the catalogs whose change fans out to many entities. */
export type DirtyKind = SearchType | 'category' | 'facility' | 'town' | 'badge';

const FANOUT_KINDS = new Set(['category', 'facility', 'town', 'badge']);

/** Aliases used across the codebase (EntityAccess types, verification, badges, plurals). */
const KIND_ALIASES: Record<string, DirtyKind> = {
  lodgings: 'lodging',
  restaurants: 'restaurant',
  experiences: 'experience',
  places: 'place',
  commerces: 'commerce',
  guides: 'guide',
  transports: 'transport',
  public_event: 'event',
  'public-event': 'event',
  publicEvent: 'event',
  events: 'event',
  categories: 'category',
  facilities: 'facility',
  towns: 'town',
  badges: 'badge',
};

/** Normalize any entity-type spelling to a DirtyKind, or null when it is not catalog data. */
export function toDirtyKind(value: unknown): DirtyKind | null {
  if (typeof value !== 'string' || !value) return null;
  if (isSearchType(value) || FANOUT_KINDS.has(value)) return value as DirtyKind;
  return KIND_ALIASES[value] ?? null;
}

export type DirtyBatch = Map<DirtyKind, string[]>;
type FlushHandler = (batch: DirtyBatch) => Promise<void>;

const FLUSH_DELAY_MS = 2000;

/**
 * Global, dependency-free collector of "this entity changed" marks. Any module can inject it
 * (no import of SearchModule → no circular dependencies); SearchModule registers the handler
 * that rebuilds and pushes the records.
 *
 * Safe mode: unless ALGOLIA_ADMIN_API_KEY + ALGOLIA_APP_ID + SEARCH_SYNC_ENABLED=true are set
 * (production only), every mark is a no-op — the local database can never reach the index.
 */
@Injectable()
export class SearchSyncQueue implements OnModuleDestroy {
  private readonly logger = new Logger(SearchSyncQueue.name);
  private readonly pending = new Map<DirtyKind, Set<string>>();
  private timer: NodeJS.Timeout | null = null;
  private handler: FlushHandler | null = null;
  private flushing: Promise<void> | null = null;
  readonly enabled: boolean;

  constructor(config: ConfigService<EnvironmentVariables>) {
    const algolia = config.get('algolia', { infer: true });
    this.enabled = !!(algolia?.appId && algolia?.adminApiKey && algolia?.syncEnabled);
    if (!this.enabled) this.logger.log('Search sync disabled (safe mode): no writes to Algolia');
  }

  registerHandler(handler: FlushHandler) {
    this.handler = handler;
  }

  /** Mark one or many identifiers (ids or slugs) of a kind as changed. Never throws. */
  mark(kind: DirtyKind | string, identifiers: string | (string | null | undefined)[] | null | undefined) {
    if (!this.enabled) return;
    const normalized = toDirtyKind(kind);
    if (!normalized) return;
    const list = (Array.isArray(identifiers) ? identifiers : [identifiers]).filter(
      (id): id is string => typeof id === 'string' && id.length > 0,
    );
    if (!list.length) return;

    const set = this.pending.get(normalized) ?? new Set<string>();
    list.forEach(id => set.add(id));
    this.pending.set(normalized, set);
    this.schedule();
  }

  private schedule() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, FLUSH_DELAY_MS);
    // Never keep the process alive just for a pending sync (shutdown flushes in onModuleDestroy).
    this.timer.unref?.();
  }

  /** Push everything pending now. Serialized: a flush waits for the previous one. */
  async flush(): Promise<void> {
    if (this.flushing) await this.flushing.catch(() => undefined);
    if (!this.pending.size || !this.handler) return;

    const batch: DirtyBatch = new Map([...this.pending].map(([kind, ids]) => [kind, [...ids]]));
    this.pending.clear();

    this.flushing = this.handler(batch)
      .catch(error => this.logger.error(`Search sync flush failed: ${(error as Error).message}`))
      .finally(() => {
        this.flushing = null;
      });
    await this.flushing;
  }

  async onModuleDestroy() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await this.flush();
  }
}
