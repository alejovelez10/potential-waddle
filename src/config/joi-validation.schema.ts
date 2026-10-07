import * as Joi from 'joi';

export const JoiValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test', 'provision').default('development'),

  APP_NAME: Joi.string().default('NestJS API Starter'),
  APP_HOST: Joi.string().default('http://localhost'),
  PORT: Joi.number().port().default(3000),

  JWT_SECRET: Joi.string().required(),
  JWT_EXPIRES_IN: Joi.string().default('30d'),

  DB_HOST: Joi.string().required(),
  DB_PORT: Joi.number().port().default(5432),
  DB_USER: Joi.string().required(),
  DB_PASSWORD: Joi.string().required(),
  DB_NAME: Joi.string().required(),
  DB_SYNCHRONIZE: Joi.boolean().default(false),
  DB_MIGRATIONS_RUN: Joi.boolean().default(false),

  CLOUDINARY_CLOUD_NAME: Joi.string().required(),
  CLOUDINARY_API_KEY: Joi.string().required(),
  CLOUDINARY_API_SECRET: Joi.string().required(),

  GOOGLE_CLIENT_ID: Joi.string().optional(),
  GOOGLE_CLIENT_SECRET: Joi.string().optional(),
  GOOGLE_CALLBACK_URL: Joi.string().optional(),

  TINYIFY_API_KEY: Joi.string().optional(),

  RESEND_API_KEY: Joi.string().required(),
  RESEND_FROM_EMAIL: Joi.string().default('Binntu <noreply@binntu.com>'),
  FRONTEND_URL: Joi.string().default('http://localhost:3000'),

  TURNSTILE_SECRET_KEY: Joi.string().optional(),

  KMIZEN_API_KEY: Joi.string().optional(),
  KMIZEN_BASE_URL: Joi.string().optional(),
  KMIZEN_SCHEMA_ID: Joi.string().optional(),
  EXTRACTION_ENGINE: Joi.string().valid('anthropic', 'kmizen').default('anthropic'),

  ANALYTICS_API_KEY: Joi.string().optional(),

  // MaxMind GeoLite2 (EVENT-03) — optional so the app still boots without geo (fail-soft, Pitfall 4)
  MAXMIND_ACCOUNT_ID: Joi.string().optional(),
  MAXMIND_LICENSE_KEY: Joi.string().optional(),
  GEOLITE_DB_PATH: Joi.string().optional(),

  // Algolia (search) — all optional: without the write key + sync flag the SearchModule is a no-op
  ALGOLIA_APP_ID: Joi.string().allow('').optional(),
  ALGOLIA_ADMIN_API_KEY: Joi.string().allow('').optional(),
  ALGOLIA_INDEX_PREFIX: Joi.string().default('prod'),
  SEARCH_SYNC_ENABLED: Joi.boolean().default(false),
  SEARCH_REINDEX_SECRET: Joi.string().allow('').optional(),
});
