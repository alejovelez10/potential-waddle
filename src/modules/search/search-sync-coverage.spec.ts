import { readdirSync, statSync } from 'fs';
import { join } from 'path';

import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';

import { ENTITY_ACCESS_KEY } from 'src/modules/common/guards/entity-access.guard';
import { SEARCH_SYNC_KEY, SEARCH_SYNC_SKIP_KEY } from './decorators/search-sync.decorator';

/**
 * Every write route of the modules that own catalog data must declare how it affects the
 * search index: `@EntityAccess` (synced automatically by the interceptor), `@SearchSync(...)`,
 * or `@SearchSyncSkip()` when it never changes what the catalog shows. A new write route without
 * any of them fails here — so a forgotten hook can't silently leave Algolia stale.
 */
const CATALOG_MODULES = [
  'lodgings',
  'restaurants',
  'commerce',
  'experiences',
  'guides',
  'transport',
  'places',
  'public-events',
  'reviews',
  'promotions',
  'core',
  'forced-public',
  'verification',
  'subscriptions',
  'towns',
  'translations',
  'google-places',
];

const WRITE_METHODS = new Set([RequestMethod.POST, RequestMethod.PUT, RequestMethod.PATCH, RequestMethod.DELETE]);

function controllerFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return controllerFiles(full);
    return name.endsWith('.controller.ts') ? [full] : [];
  });
}

describe('search sync coverage', () => {
  it('every catalog write route declares its search sync', () => {
    const missing: string[] = [];

    for (const moduleName of CATALOG_MODULES) {
      for (const file of controllerFiles(join(__dirname, '..', moduleName))) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
        const exports = require(file) as Record<string, unknown>;
        for (const exported of Object.values(exports)) {
          if (typeof exported !== 'function' || Reflect.getMetadata(PATH_METADATA, exported) === undefined) continue;
          const controller = exported as new (...args: unknown[]) => unknown;
          const classSkip = Reflect.getMetadata(SEARCH_SYNC_SKIP_KEY, controller);
          const classSync = Reflect.getMetadata(SEARCH_SYNC_KEY, controller);

          for (const key of Object.getOwnPropertyNames(controller.prototype)) {
            const handler = controller.prototype[key];
            if (key === 'constructor' || typeof handler !== 'function') continue;
            const method = Reflect.getMetadata(METHOD_METADATA, handler);
            if (method === undefined || !WRITE_METHODS.has(method)) continue;

            const covered =
              classSkip ||
              classSync ||
              Reflect.getMetadata(SEARCH_SYNC_SKIP_KEY, handler) ||
              Reflect.getMetadata(SEARCH_SYNC_KEY, handler) ||
              Reflect.getMetadata(ENTITY_ACCESS_KEY, handler);
            if (!covered) {
              const path = [Reflect.getMetadata(PATH_METADATA, controller), Reflect.getMetadata(PATH_METADATA, handler)]
                .flat()
                .join('/');
              missing.push(`${RequestMethod[method]} /${path}  (${controller.name}.${key})`);
            }
          }
        }
      }
    }

    expect(missing).toEqual([]);
  });
});
