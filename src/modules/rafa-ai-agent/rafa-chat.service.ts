import {
  BadGatewayException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { AxiosResponse } from 'axios';
import { Readable } from 'stream';

import { EnvironmentVariables } from 'src/config/app-config';

/**
 * Chat-proxy service (WEBCHAT-01 / WEBCHAT-03). The ONLY outbound hop for a
 * public visitor turn: streams rafa's `POST /api/v1/chat/stream` back to the
 * browser. Mirrors `rafa-sync.service.ts`:
 *
 *  - Injects the nest-held `x-internal-secret` (from `rafa.internalSecret`) on
 *    the OUTBOUND call — the secret NEVER reaches the browser and is NEVER
 *    logged (D-01 / T-06-08).
 *  - Fails CLOSED (503) if baseUrl/secret are unset — rafa is never called
 *    unauthenticated (rafa itself 403s without it; T-06-09).
 *  - Forwards ONLY the visitor JWT (`authorization`) if present. It reads NO
 *    browser api-key header — the front holds no secret (D-01).
 *  - `responseType: 'stream'` + `timeout: 0` so a long SSE stream is piped raw
 *    (the controller does the `@Res()` byte passthrough).
 */
@Injectable()
export class RafaChatService {
  private readonly logger = new Logger(RafaChatService.name);
  private readonly baseUrl: string;
  private readonly internalSecret: string;

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService<EnvironmentVariables>,
  ) {
    const rafa = this.config.get('rafa', { infer: true });
    this.baseUrl = rafa?.baseUrl || '';
    this.internalSecret = rafa?.internalSecret || '';
  }

  /**
   * Open a streaming POST to rafa's chat endpoint and return the raw Axios
   * response whose `data` is a `Readable` SSE byte stream (the controller pipes
   * it to the browser). Fails closed (503) if unconfigured — we NEVER call rafa
   * without the injected `x-internal-secret`. On an HTTP failure, log the
   * message only (never the secret, never the body) and rethrow a 502.
   *
   * @param body the visitor turn payload ({ messages, visitor_key }) forwarded verbatim.
   * @param opts.authorization the visitor's binntu JWT, forwarded upstream if present.
   */
  async streamChat(
    body: unknown,
    opts: { authorization?: string },
  ): Promise<AxiosResponse<Readable>> {
    if (!this.baseUrl || !this.internalSecret) {
      throw new ServiceUnavailableException(
        'Rafa chat no está configurado (RAFA_BASE_URL / RAFA_INTERNAL_SECRET).',
      );
    }

    try {
      return await firstValueFrom(
        this.http.post<Readable>(`${this.baseUrl}/api/v1/chat/stream`, body, {
          responseType: 'stream',
          headers: {
            // Server-held secret injected here ONLY — never exposed to the browser.
            'x-internal-secret': this.internalSecret,
            // Forward the visitor JWT if logged in; no browser api-key is read.
            authorization: opts.authorization ?? '',
            accept: 'text/event-stream',
          },
          // No client timeout — the SSE stream stays open for the whole turn.
          timeout: 0,
        }),
      );
    } catch (err) {
      // Never log the secret or the body — only the failure reason.
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`rafa /api/v1/chat/stream failed: ${message}`);
      throw new BadGatewayException('Failed to reach rafa chat.');
    }
  }
}
