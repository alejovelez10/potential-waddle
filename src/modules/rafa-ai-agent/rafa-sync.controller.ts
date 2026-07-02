import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { SwaggerTags } from 'src/config';
import { SuperAdmin } from '../auth/decorators';
import { RafaSyncService } from './rafa-sync.service';
import { TriggerSyncDto } from './dto';

/**
 * Sync-proxy controller (ADMIN-01 / ADMIN-03). The front's "Sincronizar" buttons
 * hit these two routes; both are super-admin-guarded (D-04). `trigger` starts a
 * sync in rafa (the only outbound hop); `status/:runId` is a local poll of the
 * sync-log — the front polls it to render live progress.
 */
@Controller('rafa-sync')
@ApiTags(SwaggerTags.RafaAdmin)
export class RafaSyncController {
  constructor(private readonly rafaSyncService: RafaSyncService) {}

  @Post('trigger')
  @SuperAdmin()
  @ApiOkResponse({ description: 'Sync triggered in rafa; returns { runId, ... }.' })
  trigger(@Body() dto: TriggerSyncDto) {
    return this.rafaSyncService.trigger(dto.target ?? 'all');
  }

  // runId is `admin-<uuid>` (rafa-minted), NOT a bare UUID — so it is read as a
  // plain string param (no uuid-parsing pipe, which would reject the admin- prefix).
  @Get('status/:runId')
  @SuperAdmin()
  @ApiOkResponse({ description: 'Run-scoped sync-log rows + knowledge sources (local read).' })
  status(@Param('runId') runId: string) {
    return this.rafaSyncService.status(runId);
  }
}
