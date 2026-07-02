import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadGatewayException, ServiceUnavailableException } from '@nestjs/common';
import { Like } from 'typeorm';
import { of, throwError } from 'rxjs';

import { RafaSyncService } from './rafa-sync.service';
import { KnowledgeSource, KnowledgeSourceSyncLog } from './entities';

const RUN_ID = 'admin-x';

const makeHttp = () => ({
  post: jest.fn(() =>
    of({ data: { run_id: RUN_ID, status: 'accepted', target: 'all' } }),
  ),
});

const makeConfig = (rafa: { baseUrl: string; internalSecret: string } | undefined) => ({
  get: jest.fn(() => rafa),
});

const makeLogRepo = (rows: unknown[] = []) => ({ find: jest.fn().mockResolvedValue(rows) });
const makeKsRepo = (rows: unknown[] = []) => ({ find: jest.fn().mockResolvedValue(rows) });

async function build(
  http: ReturnType<typeof makeHttp>,
  config: ReturnType<typeof makeConfig>,
  logRepo: ReturnType<typeof makeLogRepo>,
  ksRepo: ReturnType<typeof makeKsRepo>,
): Promise<RafaSyncService> {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      RafaSyncService,
      { provide: HttpService, useValue: http },
      { provide: ConfigService, useValue: config },
      { provide: getRepositoryToken(KnowledgeSourceSyncLog), useValue: logRepo },
      { provide: getRepositoryToken(KnowledgeSource), useValue: ksRepo },
    ],
  }).compile();
  return module.get<RafaSyncService>(RafaSyncService);
}

describe('RafaSyncService', () => {
  it('should be defined', async () => {
    const svc = await build(
      makeHttp(),
      makeConfig({ baseUrl: 'http://rafa', internalSecret: 's' }),
      makeLogRepo(),
      makeKsRepo(),
    );
    expect(svc).toBeDefined();
  });

  it('trigger() posts to rafa /internal/sync with the x-internal-secret header and returns runId', async () => {
    const http = makeHttp();
    const svc = await build(
      http,
      makeConfig({ baseUrl: 'http://rafa', internalSecret: 's' }),
      makeLogRepo(),
      makeKsRepo(),
    );

    const result = await svc.trigger('all');

    expect(http.post).toHaveBeenCalledWith(
      'http://rafa/internal/sync',
      { target: 'all' },
      expect.objectContaining({
        headers: { 'x-internal-secret': 's' },
        timeout: 10_000,
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({ runId: RUN_ID, status: 'accepted', target: 'all' }),
    );
  });

  it('trigger() fails closed (503) when baseUrl/secret are unset — rafa is never called', async () => {
    const http = makeHttp();
    const svc = await build(http, makeConfig(undefined), makeLogRepo(), makeKsRepo());

    await expect(svc.trigger('all')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(http.post).not.toHaveBeenCalled();
  });

  it('trigger() rethrows a 502 BadGateway on rafa HTTP error', async () => {
    const http = {
      post: jest.fn(() => throwError(() => new Error('connect ECONNREFUSED'))),
    };
    const svc = await build(
      http as unknown as ReturnType<typeof makeHttp>,
      makeConfig({ baseUrl: 'http://rafa', internalSecret: 's' }),
      makeLogRepo(),
      makeKsRepo(),
    );

    await expect(svc.trigger('bigquery')).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('status() reads logs with a Like(<runId>:%) filter + all sources — no rafa hop', async () => {
    const http = makeHttp();
    const logs = [{ id: 'l1', triggeredBy: 'admin-x:bigquery' }];
    const sources = [{ id: 'k1', name: 'catalog-places' }];
    const logRepo = makeLogRepo(logs);
    const ksRepo = makeKsRepo(sources);

    const svc = await build(
      http,
      makeConfig({ baseUrl: 'http://rafa', internalSecret: 's' }),
      logRepo,
      ksRepo,
    );

    const result = await svc.status('admin-x');

    expect(logRepo.find).toHaveBeenCalledWith({
      where: { triggeredBy: Like('admin-x:%') },
      order: { createdAt: 'DESC' },
    });
    expect(ksRepo.find).toHaveBeenCalledWith({ order: { name: 'ASC' } });
    expect(http.post).not.toHaveBeenCalled();
    expect(result).toEqual({ runId: 'admin-x', logs, sources });
  });
});
