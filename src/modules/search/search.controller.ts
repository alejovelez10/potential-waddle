import { Controller, Get, HttpCode, HttpStatus, Logger, Post, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';

import { SuperAdmin } from 'src/modules/auth/decorators/super-admin.decorator';
import { SearchSyncSkip } from './decorators/search-sync.decorator';
import { REINDEX_SECRET_HEADER, ReindexSecretGuard } from './guards/reindex-secret.guard';
import { SearchIndexerService } from './search-indexer.service';

@ApiTags('Search')
@Controller('search')
@SearchSyncSkip()
export class SearchController {
  private readonly logger = new Logger(SearchController.name);

  constructor(private readonly indexer: SearchIndexerService) {}

  @Get('status')
  @SuperAdmin()
  @ApiOperation({ summary: 'Whether this environment can write to Algolia (safe mode = false)' })
  status() {
    return { writable: this.indexer.enabled };
  }

  @Post('configure')
  @SuperAdmin()
  @ApiOperation({ summary: 'Apply index settings, sort replicas and synonyms' })
  configure() {
    return this.indexer.configure();
  }

  @Post('reindex')
  @SuperAdmin()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Full reindex in the background (202)' })
  reindex() {
    return this.startReindex();
  }

  @Post('cron/reindex')
  @UseGuards(ReindexSecretGuard)
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiHeader({ name: REINDEX_SECRET_HEADER, required: true })
  @ApiOperation({ summary: 'Daily full reindex triggered by the Vercel Cron (shared secret)' })
  cronReindex() {
    return this.startReindex();
  }

  @Post('cron/configure')
  @UseGuards(ReindexSecretGuard)
  @ApiHeader({ name: REINDEX_SECRET_HEADER, required: true })
  @ApiOperation({ summary: 'Apply index settings, replicas and synonyms (shared secret, after a deploy)' })
  cronConfigure() {
    return this.indexer.configure();
  }

  /** Throws 503 synchronously in safe mode; otherwise answers 202 and keeps working. */
  private startReindex() {
    const job = this.indexer.reindexAll();
    job.catch(error => this.logger.error(`Reindex failed: ${(error as Error).message}`));
    return { accepted: true };
  }
}
