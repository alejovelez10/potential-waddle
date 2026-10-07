import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';

import { EnvironmentVariables } from 'src/config';

export const REINDEX_SECRET_HEADER = 'x-search-secret';

/**
 * Machine-to-machine access for the daily Vercel Cron: `x-search-secret` must equal
 * SEARCH_REINDEX_SECRET. Fail-closed when the secret is not configured.
 */
@Injectable()
export class ReindexSecretGuard implements CanActivate {
  constructor(private readonly config: ConfigService<EnvironmentVariables>) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.get('algolia', { infer: true })?.reindexSecret ?? '';
    const request = context.switchToHttp().getRequest();
    const provided = String(request.headers?.[REINDEX_SECRET_HEADER] ?? '');

    if (!expected || !provided) throw new UnauthorizedException();
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new UnauthorizedException();
    return true;
  }
}
