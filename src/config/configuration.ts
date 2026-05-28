const parseBoolean = (value: string): boolean =>
  ['true', '1', 'yes', 'on'].includes(value.toLowerCase());

const parseNumber = (value: string): number => Number(value);

const parseOptionalNumber = (value: string | undefined): number | undefined =>
  value ? Number(value) : undefined;

const escapeRegex = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const expandLoopbackOriginAliases = (
  origins: string[],
): Array<string | RegExp> => {
  const expanded = new Map<string, string | RegExp>();

  for (const origin of origins) {
    expanded.set(origin, origin);

    try {
      const url = new URL(origin);

      if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
        const protocol = escapeRegex(url.protocol);
        expanded.set(
          `${url.protocol}//loopback:*`,
          new RegExp(`^${protocol}//(localhost|127\\.0\\.0\\.1)(:\\d+)?$`),
        );
      }
    } catch {
      // Ignore malformed origins and keep the original value.
    }
  }

  return Array.from(expanded.values());
};

const parseOrigins = (
  value: string | undefined,
  credentials: boolean,
): Array<string | RegExp> | boolean => {
  if (!value) {
    return false;
  }

  if (value === '*') {
    if (credentials) {
      throw new Error(
        'CORS_ORIGINS="*" cannot be used with CORS_CREDENTIALS=true',
      );
    }

    return true;
  }

  return expandLoopbackOriginAliases(
    value
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
};

const parseCsv = (value: string): string[] =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const parseTrustProxy = (): false | number | string => {
  if (!parseBoolean(process.env.TRUST_PROXY as string)) {
    return false;
  }

  const trustedCidrs = parseCsv(process.env.TRUST_PROXY_CIDRS ?? '').join(',');
  if (trustedCidrs) {
    return trustedCidrs;
  }

  return parseOptionalNumber(process.env.TRUST_PROXY_HOPS) ?? 1;
};

export default () => {
  const corsCredentials = parseBoolean(process.env.CORS_CREDENTIALS as string);

  return {
  app: {
    name: process.env.APP_NAME as string,
    env: process.env.NODE_ENV as string,
    port: parseNumber(process.env.PORT as string),
    apiPrefix: process.env.API_PREFIX as string,
    trustProxy: parseTrustProxy(),
    timeZone: process.env.APP_TIME_ZONE as string,
  },
  cors: {
    origin: parseOrigins(process.env.CORS_ORIGINS, corsCredentials),
    credentials: corsCredentials,
    methods: parseCsv(process.env.CORS_METHODS as string),
    allowedHeaders: parseCsv(process.env.CORS_ALLOWED_HEADERS as string),
    exposedHeaders: parseCsv(process.env.CORS_EXPOSED_HEADERS as string),
  },
  logger: {
    level: process.env.LOG_LEVEL as string,
    prettyPrint: parseBoolean(process.env.LOG_PRETTY_PRINT as string),
  },
  storage: {
    endpoint: process.env.STORAGE_S3_ENDPOINT as string,
    accessKey: process.env.STORAGE_S3_ACCESS_KEY as string,
    secretKey: process.env.STORAGE_S3_SECRET_KEY as string,
    bucket: process.env.STORAGE_S3_BUCKET as string,
    forcePathStyle: parseBoolean(process.env.STORAGE_S3_FORCE_PATH_STYLE as string),
    publicBaseUrl: process.env.STORAGE_S3_PUBLIC_BASE_URL as string,
    maxUploadSize: parseNumber(process.env.STORAGE_MAX_UPLOAD_SIZE as string),
  },
  database: {
    url: process.env.DATABASE_URL as string,
  },
  redis: {
    url: process.env.REDIS_URL as string,
  },
  queue: {
    prefix: process.env.QUEUE_PREFIX as string,
  },
  auth: {
    accessTokenSecret: process.env.AUTH_ACCESS_TOKEN_SECRET as string,
    accessTokenTtl: process.env.AUTH_ACCESS_TOKEN_TTL as string,
    refreshTokenSecret: process.env.AUTH_REFRESH_TOKEN_SECRET as string,
    refreshTokenTtl: process.env.AUTH_REFRESH_TOKEN_TTL as string,
  },
  identity: {
    baseUrl: process.env.IDENTITY_BASE_URL?.trim() || undefined,
    internalToken:
      process.env.IDENTITY_INTERNAL_TOKEN?.trim() ||
      'change-me-identity-internal-token',
    signalsTimeoutMs: parseOptionalNumber(
      process.env.IDENTITY_SIGNALS_TIMEOUT_MS,
    ),
  },
  moderation: {
    imageAnalyzerUrl: process.env.IMAGE_ANALYZER_WORKER_URL?.trim() || undefined,
    imageAnalyzerTimeoutMs: parseOptionalNumber(
      process.env.IMAGE_ANALYZER_TIMEOUT_MS,
    ),
    textAnalyzerUrl: process.env.TEXT_ANALYZER_WORKER_URL?.trim() || undefined,
    textAnalyzerTimeoutMs: parseOptionalNumber(
      process.env.TEXT_ANALYZER_TIMEOUT_MS,
    ),
    internalToken:
      process.env.MODERATION_INTERNAL_TOKEN?.trim() ||
      'change-me-moderation-internal-token',
  },
  chatApi: {
    baseUrl: process.env.CHAT_API_BASE_URL?.trim() || undefined,
    internalToken: process.env.CHAT_API_INTERNAL_TOKEN?.trim() || undefined,
    timeoutMs: parseOptionalNumber(process.env.CHAT_API_TIMEOUT_MS),
  },
  notifications: {
    baseUrl: process.env.NOTIFICATIONS_API_BASE_URL?.trim() || undefined,
    internalToken:
      process.env.NOTIFICATIONS_INTERNAL_TOKEN?.trim() || undefined,
    timeoutMs: parseOptionalNumber(process.env.NOTIFICATIONS_API_TIMEOUT_MS),
  },
  rateLimit: {
    ttl: parseNumber(process.env.RATE_LIMIT_TTL as string),
    limit: parseNumber(process.env.RATE_LIMIT_LIMIT as string),
    sensitiveTtl: parseNumber(process.env.SENSITIVE_RATE_LIMIT_TTL as string),
    sensitiveLimit: parseNumber(process.env.SENSITIVE_RATE_LIMIT_LIMIT as string),
  },
  };
};
