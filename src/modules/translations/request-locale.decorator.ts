import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const LOCALE_HEADER = 'x-locale';
export const SUPPORTED_LOCALES = ['es', 'en'] as const; // extensible; unknown -> DEFAULT
export const DEFAULT_LOCALE = 'es';

/**
 * @RequestLocale param decorator — safely reads the requested locale.
 *
 * Resolution order: x-locale header → ?locale= query param → DEFAULT_LOCALE ('es').
 * Input is lowercased and validated against SUPPORTED_LOCALES allowlist.
 * Unknown / missing locales collapse to 'es' — no distinct behavior leaks which locales exist (T-27-05).
 * Locale string is never concatenated into raw SQL; used only as a parameterized filter value (T-27-04).
 *
 * Open Question 2 RESOLVED: standalone param decorator only — no interceptor registered.
 */
export const RequestLocale = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const request = ctx.switchToHttp().getRequest();
  // Prefer header (D-09), then ?locale= query (required for Next.js Data Cache key, Pitfall 6)
  const raw = (request.headers?.[LOCALE_HEADER] ?? request.query?.locale ?? '').toString().toLowerCase();
  return (SUPPORTED_LOCALES as readonly string[]).includes(raw) ? raw : DEFAULT_LOCALE;
});
