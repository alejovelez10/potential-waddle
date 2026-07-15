export interface EnvironmentVariables {
  env: string;
  appName: string;
  http: {
    port: number;
    host: string;
  };
  jwt: {
    secret: string;
    expiresIn: string;
  };
  database: {
    host: string;
    port: number;
    user: string;
    password: string;
    name: string;
    synchronize: boolean;
    migrationsRun?: boolean;
  };
  cloudinary: {
    cloudName: string;
    apiKey: string;
    apiSecret: string;
  };
  serpApi: {
    apiKey: string;
  };
  apify: {
    apiKey: string;
  };
  googleOAuth: {
    clientId: string;
    clientSecret: string;
    callbackUrl: string;
  };
  googlePlaces: {
    apiKey: string;
  };
  tinify: {
    apiKey: string;
    enabled: boolean;
  };
  pinecone: {
    apiKey: string;
    environment: string;
    pineconeIndexGoogleReview: string;
    pineconeIndexRafaClaude: string;
    pineconeIndexVectorizedData: string;
  };
  indexingApi: {
    apiKey: string;
  };
  anthropic: {
    apiKey: string;
    model: string;
  };
  menuExtraction: {
    model: string;
    engine: 'anthropic' | 'kmizen';
    maxTokens: number;
  };
  openai: {
    apiKey: string;
  };
  googleRoutesApi: {
    apiKey: string;
  };
  resend: {
    apiKey: string;
    fromEmail: string;
    adminNotificationEmail: string;
  };
  turnstile: {
    secretKey: string;
  };
  gemini: {
    apiKey: string;
    model: string;
  };
  kmizen: {
    apiKey: string;
    baseUrl: string;
  };
  rafa: {
    baseUrl: string;
    internalSecret: string;
  };
  analytics: {
    apiKey: string;
  };
  maxmind: {
    accountId: string;
    licenseKey: string;
    dbPath: string;
  };
  frontendUrl: string;
}

export const appConfig = (): EnvironmentVariables => ({
  env: process.env.NODE_ENV || 'development',
  appName: process.env.APP_NAME || 'NestJS API Starter',

  http: {
    port: parseInt(process.env.PORT || '3000', 10) || 3000,
    host: process.env.APP_HOST || 'localhost',
  },

  jwt: {
    secret: process.env.JWT_SECRET || '',
    expiresIn: process.env.JWT_EXPIRES_IN || '30d',
  },

  database: {
    host: process.env.DB_HOST || '',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER || '',
    password: process.env.DB_PASSWORD || '',
    name: process.env.DB_NAME || '',
    synchronize: process.env.DB_SYNCHRONIZE === 'true',
    migrationsRun: process.env.DB_MIGRATIONS_RUN === 'true',
  },
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME || '',
    apiKey: process.env.CLOUDINARY_API_KEY || '',
    apiSecret: process.env.CLOUDINARY_API_SECRET || '',
  },
  googleOAuth: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    callbackUrl: process.env.GOOGLE_CALLBACK_URL || '',
  },
  googlePlaces: {
    apiKey: process.env.GOOGLE_PLACES_API_KEY || '',
  },
  serpApi: {
    apiKey: process.env.SERP_API_KEY || '',
  },
  apify: {
    apiKey: process.env.APIFY_API_KEY || '',
  },
  tinify: {
    apiKey: process.env.TINYIFY_API_KEY || '',
    enabled: Boolean(process.env.TINYIFY_API_KEY),
  },
  pinecone: {
    apiKey: process.env.PINECONE_API_KEY || '',
    environment: process.env.PINECONE_ENVIRONMENT || '',
    pineconeIndexGoogleReview: process.env.PINECONE_INDEX_BINNTU_GOOGLE_REVIEW || '',
    pineconeIndexRafaClaude: process.env.PINECONE_INDEX_RAFA_CLAUDE || '',
    pineconeIndexVectorizedData: process.env.PINECONE_INDEX_VECTORIZED_DATA || 'rafa-vectorized-data',
  },
  indexingApi: {
    apiKey: process.env.INDEXING_API_KEY || '',
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY || '',
    model: process.env.ANTHROPIC_MODEL || '',
  },
  // Dedicated model for menu extraction — decoupled from Rafa's ANTHROPIC_MODEL.
  menuExtraction: {
    model: process.env.MENU_EXTRACTION_MODEL || 'claude-haiku-4-5',
    engine: (process.env.EXTRACTION_ENGINE as 'anthropic' | 'kmizen') || 'anthropic',
    // Output token ceiling for the extraction call. High default so large/nested
    // menus are not truncated (haiku-4-5 supports up to 64k output). Billed on actual output.
    maxTokens: parseInt(process.env.MENU_EXTRACTION_MAX_TOKENS || '16384', 10),
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
  },
  googleRoutesApi: {
    apiKey: process.env.GOOGLE_ROUTES_API_KEY || '',
  },
  resend: {
    apiKey: process.env.RESEND_API_KEY || '',
    fromEmail: process.env.RESEND_FROM_EMAIL || 'Binntu <noreply@binntu.com>',
    adminNotificationEmail: process.env.ADMIN_NOTIFICATION_EMAIL || '',
  },
  turnstile: {
    secretKey: process.env.TURNSTILE_SECRET_KEY || '',
  },
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
    model: process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite',
  },
  kmizen: {
    apiKey: process.env.KMIZEN_API_KEY || '',
    baseUrl: process.env.KMIZEN_BASE_URL || '',
  },
  // Rafa AI service (rafa-ai-service) — the sync-proxy hop target. `internalSecret`
  // MUST match rafa's INTERNAL_SECRET (Plan 05-01); it is sent in the
  // `x-internal-secret` header on POST /internal/sync. Fail-closed if unset.
  rafa: {
    baseUrl: process.env.RAFA_BASE_URL || '',
    internalSecret: process.env.RAFA_INTERNAL_SECRET || '',
  },
  analytics: {
    apiKey: process.env.ANALYTICS_API_KEY || '',
  },
  // MaxMind GeoLite2 (EVENT-03): credentials for the boot-time .mmdb download.
  // Optional/fail-soft — if absent, geo enrichment degrades to null (Pitfall 4).
  maxmind: {
    accountId: process.env.MAXMIND_ACCOUNT_ID || '',
    licenseKey: process.env.MAXMIND_LICENSE_KEY || '',
    dbPath: process.env.GEOLITE_DB_PATH || './geoip/GeoLite2-City.mmdb',
  },
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
});
