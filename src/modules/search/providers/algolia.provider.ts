import { ConfigService } from '@nestjs/config';
import { algoliasearch } from 'algoliasearch';

import { EnvironmentVariables } from 'src/config';
import { ALGOLIA_CLIENT } from '../search.constants';

export type AlgoliaClient = ReturnType<typeof algoliasearch>;

/**
 * Write client, or `null` in safe mode. Only production sets ALGOLIA_ADMIN_API_KEY +
 * SEARCH_SYNC_ENABLED=true; anywhere else no client is created and nothing can be indexed.
 */
export const AlgoliaClientProvider = {
  provide: ALGOLIA_CLIENT,
  useFactory: (config: ConfigService<EnvironmentVariables>): AlgoliaClient | null => {
    const algolia = config.get('algolia', { infer: true });
    if (!algolia?.appId || !algolia?.adminApiKey || !algolia?.syncEnabled) return null;
    return algoliasearch(algolia.appId, algolia.adminApiKey);
  },
  inject: [ConfigService],
};
