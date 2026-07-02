import {
  BadGatewayException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { firstValueFrom } from 'rxjs';
import { Like, Repository } from 'typeorm';

import { EnvironmentVariables } from 'src/config/app-config';
import { KnowledgeSource, KnowledgeSourceSyncLog } from './entities';

/**
 * Sync-proxy service (ADMIN-01 / ADMIN-03). Two responsibilities:
 *
 *  - `trigger()` — the ONLY outbound hop: POST rafa's /internal/sync with the
 *    shared `x-internal-secret` header (D-05). Fails CLOSED (never calls rafa
 *    unauthenticated) if baseUrl/secret are unset. The secret is NEVER logged.
 *  - `status()` — a pure LOCAL TypeORM read of `knowledge_source_sync_log` +
 *    `knowledge_source` (nest owns the DB). NO rafa hop — the front polls this.
 *
 * The run tag rafa writes is `admin-<uuid>:<step>`, so status filters the log by
 * `triggeredBy LIKE '<runId>:%'` to scope one run.
 */
@Injectable()
export class RafaSyncService {
  private readonly logger = new Logger(RafaSyncService.name);
  private readonly baseUrl: string;
  private readonly internalSecret: string;

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService<EnvironmentVariables>,
    @InjectRepository(KnowledgeSourceSyncLog)
    private readonly logRepo: Repository<KnowledgeSourceSyncLog>,
    @InjectRepository(KnowledgeSource)
    private readonly ksRepo: Repository<KnowledgeSource>,
  ) {
    const rafa = this.config.get('rafa', { infer: true });
    this.baseUrl = rafa?.baseUrl || '';
    this.internalSecret = rafa?.internalSecret || '';
  }

  /**
   * Trigger a catalog sync in rafa. Fails closed (503) if the base URL or the
   * internal secret is not configured — we NEVER call rafa without the secret.
   * On an HTTP failure, log the message only (never the secret) and rethrow a
   * 502 BadGateway. Returns `{ runId, ...data }` (rafa mints `admin-<uuid>`).
   */
  async trigger(target: 'bigquery' | 'vertex' | 'all') {
    if (!this.baseUrl || !this.internalSecret) {
      throw new ServiceUnavailableException(
        'Rafa sync is not configured (RAFA_BASE_URL / RAFA_INTERNAL_SECRET missing).',
      );
    }

    try {
      const { data } = await firstValueFrom(
        this.http.post(
          `${this.baseUrl}/internal/sync`,
          { target },
          {
            headers: { 'x-internal-secret': this.internalSecret },
            timeout: 10_000,
          },
        ),
      );
      return { runId: data.run_id, ...data };
    } catch (err) {
      // Never log the secret — only the failure reason.
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`rafa /internal/sync failed for target=${target}: ${message}`);
      throw new BadGatewayException('Failed to trigger sync in rafa.');
    }
  }

  /**
   * Status of a run: a LOCAL read (no rafa hop). Returns the run's sync-log rows
   * (tagged `<runId>:<step>`) newest-first plus every knowledge source with its
   * `last_sync_*` roll-up, so the front can render per-source progress.
   */
  async status(runId: string) {
    const logs = await this.logRepo.find({
      where: { triggeredBy: Like(`${runId}:%`) },
      order: { createdAt: 'DESC' },
    });
    const sources = await this.ksRepo.find({ order: { name: 'ASC' } });
    return { runId, logs, sources };
  }
}
