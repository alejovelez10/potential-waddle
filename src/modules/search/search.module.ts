import { Module } from '@nestjs/common';

import { SubscriptionsModule } from 'src/modules/subscriptions/subscriptions.module';
import { TranslationsModule } from 'src/modules/translations/translations.module';
import { VerificationModule } from 'src/modules/verification/verification.module';
import { SearchRecordBuilderService } from './builders/search-record-builder.service';
import { ReindexSecretGuard } from './guards/reindex-secret.guard';
import { AlgoliaClientProvider } from './providers/algolia.provider';
import { SearchIndexerService } from './search-indexer.service';
import { SearchController } from './search.controller';

/**
 * Algolia catalog indexing. Reads Postgres, writes Algolia — the write side only exists in
 * production (see AlgoliaClientProvider / SearchSyncQueue safe mode). SearchSyncQueue comes
 * from the global SearchSyncModule.
 */
@Module({
  imports: [SubscriptionsModule, VerificationModule, TranslationsModule],
  controllers: [SearchController],
  providers: [AlgoliaClientProvider, SearchRecordBuilderService, SearchIndexerService, ReindexSecretGuard],
  exports: [SearchRecordBuilderService, SearchIndexerService],
})
export class SearchModule {}
