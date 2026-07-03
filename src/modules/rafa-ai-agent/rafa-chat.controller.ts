import { Body, Controller, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';

import { SwaggerTags } from 'src/config';
import { RafaChatService } from './rafa-chat.service';

/**
 * Chat-proxy controller (WEBCHAT-01 / WEBCHAT-03, D-01 locked hop). A PUBLIC
 * `POST /rafa-ai-agent/chat` that pipes rafa's streamed SSE to the browser
 * unmodified via a raw `@Res()` byte passthrough (Nest's `@Sse()` would re-frame
 * the Vercel AI Data Stream Protocol — RESEARCH Pitfall 2).
 *
 * The nest-held `x-internal-secret` is injected INSIDE the service (never here,
 * never to the browser). The controller forwards only the visitor JWT
 * (`authorization`) and reads NO browser api-key (the front holds no secret).
 * The minted anon `x-rafa-visitor-key` is echoed back and CORS-exposed.
 */
@Controller('rafa-ai-agent')
@ApiTags(SwaggerTags.RafaAdmin)
export class RafaChatController {
  constructor(private readonly rafaChatService: RafaChatService) {}

  // PÚBLICO: turno de visitante anónimo. Rate-limit/CORS = Fase 7 (T-06-DoS diferido).
  @Post('chat')
  async chat(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: unknown,
  ): Promise<void> {
    // Forward ONLY the visitor JWT; the server-held x-internal-secret is
    // injected inside the service (D-01: the front holds no secret).
    const upstream = await this.rafaChatService.streamChat(body, {
      authorization: req.headers['authorization'] as string,
    });

    // Passthrough SSE headers BEFORE piping any bytes.
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    // Defeat proxy buffering so tokens flush individually (Pitfall 2/3).
    res.setHeader('X-Accel-Buffering', 'no');

    // Echo the minted anon visitor key and expose it to the browser (CORS).
    const vk = (upstream.headers['x-rafa-visitor-key'] as string) ?? '';
    res.setHeader('x-rafa-visitor-key', vk);
    res.setHeader('Access-Control-Expose-Headers', 'x-rafa-visitor-key');

    // Raw byte passthrough — no re-encoding (preserves the exact Vercel protocol).
    upstream.data.on('error', () => {
      // Do not leak upstream details; just close the client stream.
      res.end();
    });
    upstream.data.pipe(res);
  }
}
