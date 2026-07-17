import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { EntityTranslation } from './entities/entity-translation.entity';
import { TranslationResolverService } from './translation-resolver.service';
import { TranslationSeedingService } from './seeding/translation-seeding.service';
import { TranslationSweepCron } from './seeding/translation-sweep.cron';
import { TranslationsController } from './translations.controller';
import { AdminTranslationsController } from './admin-translations.controller';

// Owner entities needed by resolveOwnerUserId / assertOwnership IDOR checks.
// Imported directly (not via their feature modules) to avoid circular dependencies.
import { Lodging } from '../lodgings/entities/lodging.entity';
import { Experience } from '../experiences/entities/experience.entity';
import { Restaurant } from '../restaurants/entities/restaurant.entity';
import { Commerce } from '../commerce/entities/commerce.entity';
import { Guide } from '../guides/entities/guide.entity';

/**
 * TranslationsModule — owns the entity_translation table.
 *
 * Providers:
 *   - TranslationResolverService: read-path (batchLoad, load, overlay).
 *   - TranslationSeedingService: write-path (seedEntity, needsSeeding, upsertTranslation,
 *     sweepPending, overrideTranslation, getTranslationState, seedOnDemand, and the
 *     admin-only seedAdminEntity/overrideAdmin/batchStateForIds/countMissingForType/
 *     seedMissingForType added in quick 260717-abz).
 *   - TranslationSweepCron: sweepPending({ batchSize: 50 }) — its @Cron(EVERY_10_MINUTES)
 *     schedule is DISABLED (quick 260717-abz, D-5; see translation-sweep.cron.ts for why).
 *     Seeding is now manual via POST /translations/admin/:entityType/seed-missing.
 *
 * Controllers:
 *   - TranslationsController: owner-facing (@Auth() + IDOR ownership).
 *   - AdminTranslationsController: superadmin-only (@SuperAdmin()), category/facility
 *     only (ADMIN_TRANSLATABLE_ENTITY_TYPES) — these entities have no owner column.
 *
 * String-token providers ('LodgingRepository', 'ExperienceRepository', etc.) supply the
 * TypeORM repositories needed by TranslationSeedingService.assertOwnership / resolveOwnerUserId
 * without importing the feature modules (avoids circular-dep risk).
 * TypeOrmModule.forFeature registers the entity connection for TypeORM repository injection.
 *
 * AppModule (line 99) already imports TranslationsModule and ScheduleModule.forRoot() — no
 * app.module.ts changes required.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      EntityTranslation,
      // Owner entities required by IDOR ownership resolver
      Lodging,
      Experience,
      Restaurant,
      Commerce,
      Guide,
    ]),
  ],
  controllers: [TranslationsController, AdminTranslationsController],
  providers: [
    TranslationResolverService,
    TranslationSeedingService,
    TranslationSweepCron,
    // String-token repository providers — decouples TranslationsModule from feature modules
    // while giving TranslationSeedingService real TypeORM repositories at runtime.
    {
      provide: 'LodgingRepository',
      useFactory: (dataSource: DataSource) => dataSource.getRepository(Lodging),
      inject: [DataSource],
    },
    {
      provide: 'ExperienceRepository',
      useFactory: (dataSource: DataSource) => dataSource.getRepository(Experience),
      inject: [DataSource],
    },
    // Restaurant, Commerce, Guide fall back to the LodgingRepository pattern in assertOwnership;
    // these additional tokens are reserved for future expansion of per-type IDOR resolution.
    {
      provide: 'RestaurantRepository',
      useFactory: (dataSource: DataSource) => dataSource.getRepository(Restaurant),
      inject: [DataSource],
    },
    {
      provide: 'CommerceRepository',
      useFactory: (dataSource: DataSource) => dataSource.getRepository(Commerce),
      inject: [DataSource],
    },
    {
      provide: 'GuideRepository',
      useFactory: (dataSource: DataSource) => dataSource.getRepository(Guide),
      inject: [DataSource],
    },
  ],
  exports: [TranslationResolverService, TranslationSeedingService],
})
export class TranslationsModule {}
