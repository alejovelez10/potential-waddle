import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';

import { SearchSyncInterceptor } from './search-sync.interceptor';
import { SearchSyncQueue } from './search-sync.queue';

/**
 * Global and dependency-free on purpose: any module (subscriptions, google sync, menus…) can
 * inject SearchSyncQueue without importing SearchModule, which itself depends on several of
 * those modules. Also registers the interceptor that marks entities after successful writes.
 */
@Global()
@Module({
  providers: [SearchSyncQueue, { provide: APP_INTERCEPTOR, useClass: SearchSyncInterceptor }],
  exports: [SearchSyncQueue],
})
export class SearchSyncModule {}
