import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { of } from 'rxjs';

import { RafaChatService } from './rafa-chat.service';

const SECRET = 'super-secret-value';

const makeHttp = () => ({
  post: jest.fn(() => of({ data: { pipe: jest.fn() }, headers: {} })),
});

const makeConfig = (rafa: { baseUrl: string; internalSecret: string } | undefined) => ({
  get: jest.fn(() => rafa),
});

async function build(
  http: ReturnType<typeof makeHttp>,
  config: ReturnType<typeof makeConfig>,
): Promise<RafaChatService> {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      RafaChatService,
      { provide: HttpService, useValue: http },
      { provide: ConfigService, useValue: config },
    ],
  }).compile();
  return module.get<RafaChatService>(RafaChatService);
}

describe('RafaChatService', () => {
  it('should be defined', async () => {
    const svc = await build(
      makeHttp(),
      makeConfig({ baseUrl: 'http://rafa', internalSecret: SECRET }),
    );
    expect(svc).toBeDefined();
  });

  it('fails closed (503) when baseUrl/secret are unset — http.post is never called', async () => {
    const http = makeHttp();
    const svc = await build(http, makeConfig(undefined));

    await expect(svc.streamChat({ messages: [] }, {})).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(http.post).not.toHaveBeenCalled();
  });

  it('posts to /api/v1/chat/stream with the injected x-internal-secret, forwards authorization, responseType stream, and sets NO x-api-key', async () => {
    const http = makeHttp();
    const svc = await build(
      http,
      makeConfig({ baseUrl: 'http://rafa', internalSecret: SECRET }),
    );

    const body = { messages: [{ role: 'user' }], visitor_key: null };
    await svc.streamChat(body, { authorization: 'Bearer jwt-abc' });

    expect(http.post).toHaveBeenCalledTimes(1);
    const [url, sentBody, cfg] = http.post.mock.calls[0] as unknown as [
      string,
      unknown,
      { responseType: string; headers: Record<string, string> },
    ];

    expect(url).toBe('http://rafa/api/v1/chat/stream');
    expect(sentBody).toBe(body);
    expect(cfg.responseType).toBe('stream');
    expect(cfg.headers['x-internal-secret']).toBe(SECRET);
    expect(cfg.headers.authorization).toBe('Bearer jwt-abc');
    expect(cfg.headers.accept).toBe('text/event-stream');
    // No browser secret is ever forwarded — only the injected x-internal-secret.
    const headerKeys = Object.keys(cfg.headers).map(k => k.toLowerCase());
    expect(headerKeys).not.toContain('x-api-key');
  });

  it('never logs the internal secret', async () => {
    const logSpy = jest.spyOn(Logger.prototype, 'error');
    const http = makeHttp();
    const svc = await build(
      http,
      makeConfig({ baseUrl: 'http://rafa', internalSecret: SECRET }),
    );

    await svc.streamChat({ messages: [] }, { authorization: 'Bearer x' });

    for (const call of logSpy.mock.calls) {
      for (const arg of call) {
        expect(String(arg)).not.toContain(SECRET);
      }
    }
    logSpy.mockRestore();
  });
});
