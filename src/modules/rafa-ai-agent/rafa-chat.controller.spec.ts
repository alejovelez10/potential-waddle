import { Test, TestingModule } from '@nestjs/testing';
import { Request, Response } from 'express';

import { RafaChatController } from './rafa-chat.controller';
import { RafaChatService } from './rafa-chat.service';

const makeService = () => ({
  streamChat: jest.fn(),
});

/** Minimal express-like `res` capturing headers + the piped stream. */
const makeRes = () => {
  const headers: Record<string, string> = {};
  return {
    headers,
    setHeader: jest.fn((k: string, v: string) => {
      headers[k] = v;
    }),
    end: jest.fn(),
  } as unknown as Response & { headers: Record<string, string> };
};

/** Fake upstream Axios response: a `data` stream (pipe/on) + headers. */
const makeUpstream = (visitorKey = 'anon-123') => {
  const data = { pipe: jest.fn(), on: jest.fn() };
  return { data, headers: { 'x-rafa-visitor-key': visitorKey } };
};

describe('RafaChatController', () => {
  let controller: RafaChatController;
  let service: ReturnType<typeof makeService>;

  beforeEach(async () => {
    jest.clearAllMocks();
    service = makeService();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [RafaChatController],
      providers: [{ provide: RafaChatService, useValue: service }],
    }).compile();

    controller = module.get<RafaChatController>(RafaChatController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('calls streamChat with the forwarded authorization and passes NO api-key', async () => {
    service.streamChat.mockResolvedValue(makeUpstream());
    const req = { headers: { authorization: 'Bearer jwt-abc' } } as unknown as Request;
    const res = makeRes();

    const body = { messages: [{ role: 'user' }], visitor_key: null };
    await controller.chat(req, res, body);

    expect(service.streamChat).toHaveBeenCalledTimes(1);
    const [sentBody, opts] = service.streamChat.mock.calls[0] as unknown as [
      unknown,
      Record<string, unknown>,
    ];
    expect(sentBody).toBe(body);
    expect(opts.authorization).toBe('Bearer jwt-abc');
    // No browser api-key is ever read/forwarded (D-01).
    const optKeys = Object.keys(opts).map(k => k.toLowerCase());
    expect(optKeys).not.toContain('x-api-key');
  });

  it('sets SSE + anti-buffering + CORS-exposed visitor-key headers', async () => {
    service.streamChat.mockResolvedValue(makeUpstream('anon-777'));
    const req = { headers: {} } as unknown as Request;
    const res = makeRes();

    await controller.chat(req, res, { messages: [] });

    expect(res.headers['Content-Type']).toBe('text/event-stream');
    expect(res.headers['X-Accel-Buffering']).toBe('no');
    expect(res.headers['x-rafa-visitor-key']).toBe('anon-777');
    expect(res.headers['Access-Control-Expose-Headers']).toBe('x-rafa-visitor-key');
  });

  it('pipes upstream.data to res (raw byte passthrough)', async () => {
    const upstream = makeUpstream();
    service.streamChat.mockResolvedValue(upstream);
    const req = { headers: {} } as unknown as Request;
    const res = makeRes();

    await controller.chat(req, res, { messages: [] });

    expect(upstream.data.pipe).toHaveBeenCalledWith(res);
  });

  // The chat route is PUBLIC — it carries NO guards (no @SuperAdmin()). Assert
  // via reflected metadata (contrast with rafa-sync/rafa-admin which are guarded).
  it('the chat route is public — no __guards__ metadata', () => {
    const handler = (RafaChatController.prototype as unknown as Record<string, object>).chat;
    const guards = Reflect.getMetadata('__guards__', handler);
    expect(guards).toBeUndefined();
  });
});
