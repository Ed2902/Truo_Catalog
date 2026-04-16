const parseBoolean = (value: string): boolean =>
  ['true', '1', 'yes', 'on'].includes(value.toLowerCase());

const parseNumber = (value: string): number => Number(value);

const parseOptionalNumber = (value: string | undefined): number | undefined =>
  value ? Number(value) : undefined;

const parseOrigins = (value: string | undefined): string[] | boolean => {
  if (!value) {
    return false;
  }

  if (value === '*') {
    return true;
  }

  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
};

const parseCsv = (value: string): string[] =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

export default () => ({
  app: {
    name: process.env.APP_NAME as string,
    env: process.env.NODE_ENV as string,
    port: parseNumber(process.env.PORT as string),
    apiPrefix: process.env.API_PREFIX as string,
    trustProxy: parseBoolean(process.env.TRUST_PROXY as string),
    timeZone: process.env.APP_TIME_ZONE as string,
  },
  cors: {
    origin: parseOrigins(process.env.CORS_ORIGINS),
    credentials: parseBoolean(process.env.CORS_CREDENTIALS as string),
    methods: parseCsv(process.env.CORS_METHODS as string),
    allowedHeaders: parseCsv(process.env.CORS_ALLOWED_HEADERS as string),
    exposedHeaders: parseCsv(process.env.CORS_EXPOSED_HEADERS as string),
  },
  logger: {
    level: process.env.LOG_LEVEL as string,
    prettyPrint: parseBoolean(process.env.LOG_PRETTY_PRINT as string),
  },
  database: {
    url: process.env.DATABASE_URL as string,
  },
  auth: {
    accessTokenSecret: process.env.AUTH_ACCESS_TOKEN_SECRET as string,
    accessTokenTtl: process.env.AUTH_ACCESS_TOKEN_TTL as string,
    refreshTokenSecret: process.env.AUTH_REFRESH_TOKEN_SECRET as string,
    refreshTokenTtl: process.env.AUTH_REFRESH_TOKEN_TTL as string,
  },
  identity: {
    baseUrl: process.env.IDENTITY_BASE_URL?.trim() || undefined,
    internalToken: process.env.IDENTITY_INTERNAL_TOKEN?.trim() || undefined,
    signalsTimeoutMs: parseOptionalNumber(
      process.env.IDENTITY_SIGNALS_TIMEOUT_MS,
    ),
  },
  rateLimit: {
    ttl: parseNumber(process.env.RATE_LIMIT_TTL as string),
    limit: parseNumber(process.env.RATE_LIMIT_LIMIT as string),
    sensitiveTtl: parseNumber(process.env.SENSITIVE_RATE_LIMIT_TTL as string),
    sensitiveLimit: parseNumber(process.env.SENSITIVE_RATE_LIMIT_LIMIT as string),
  },
});
