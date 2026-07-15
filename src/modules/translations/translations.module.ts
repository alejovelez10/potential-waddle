import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EntityTranslation } from './entities/entity-translation.entity';
import { TranslationResolverService } from './translation-resolver.service';
import { TranslationSeedingService } from './seeding/translation-seeding.service';

/**
 * TranslationsModule — owns the entity_translation table.
 *
 * Providers:
 *   - TranslationResolverService: read-path (batchLoad, load, overlay).
 *   - TranslationSeedingService: write-path (seedEntity, needsSeeding, upsertTranslation,
 *     sweepPending, overrideTranslation).
 *
 * Note: TranslationSeedingService requires 'LodgingRepository' and 'ExperienceRepository'
 * string-token injections for the IDOR ownership checks in overrideTranslation. These are
 * registered by 28-03 when it wires the controller + cron into AppModule. For unit tests,
 * the spec provides mock factories under the same string tokens.
 */
@Module({
  imports: [TypeOrmModule.forFeature([EntityTranslation])],
  providers: [TranslationResolverService, TranslationSeedingService],
  exports: [TranslationResolverService, TranslationSeedingService],
})
export class TranslationsModule {}
