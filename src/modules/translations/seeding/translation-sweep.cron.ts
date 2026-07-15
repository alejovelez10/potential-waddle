import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { TranslationSeedingService } from './translation-seeding.service';

/**
 * TranslationSweepCron (MT-03) — background sweep that re-seeds stale 'auto'/empty rows.
 *
 * Runs every 10 minutes in bounded batches (batchSize: 50) so a large backlog
 * cannot overwhelm Gemini quota or slow the cron loop.
 *
 * The revisado-skip guarantee is enforced by the upsert SQL inside
 * TranslationSeedingService.upsertTranslation (WHERE source != 'revisado'), NOT here.
 * This class only delegates to sweepPending and logs.
 */
@Injectable()
export class TranslationSweepCron {
  private readonly logger = new Logger(TranslationSweepCron.name);

  constructor(private readonly seedingService: TranslationSeedingService) {}

  // MT-03: re-seed stale 'auto'/empty rows in bounded batches; never touches 'revisado'
  // (guaranteed by the upsert WHERE source != 'revisado' guard in seedEntity/upsertTranslation).
  @Cron(CronExpression.EVERY_10_MINUTES)
  async sweep(): Promise<void> {
    this.logger.log('(translation-sweep) Starting translation sweep...');
    await this.seedingService.sweepPending({ batchSize: 50 });
    this.logger.log('(translation-sweep) Sweep done.');
  }
}
