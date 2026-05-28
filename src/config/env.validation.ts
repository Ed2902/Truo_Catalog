import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  APP_NAME: Joi.string().trim().required(),
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .required(),
  PORT: Joi.number().port().required(),
  API_PREFIX: Joi.string().trim().required(),
  TRUST_PROXY: Joi.boolean().required(),
  APP_TIME_ZONE: Joi.string().trim().required(),
  CORS_ORIGINS: Joi.string()
    .allow('')
    .required(),
  CORS_CREDENTIALS: Joi.boolean().required(),
  CORS_METHODS: Joi.string().trim().required(),
  CORS_ALLOWED_HEADERS: Joi.string().trim().required(),
  CORS_EXPOSED_HEADERS: Joi.string().trim().required(),
  LOG_LEVEL: Joi.string()
    .valid('fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent')
    .required(),
  LOG_PRETTY_PRINT: Joi.boolean().required(),
  STORAGE_S3_ENDPOINT: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .required(),
  STORAGE_S3_ACCESS_KEY: Joi.string().trim().required(),
  STORAGE_S3_SECRET_KEY: Joi.string().trim().required(),
  STORAGE_S3_BUCKET: Joi.string().trim().required(),
  STORAGE_S3_FORCE_PATH_STYLE: Joi.boolean().required(),
  STORAGE_S3_PUBLIC_BASE_URL: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .required(),
  STORAGE_MAX_UPLOAD_SIZE: Joi.number().positive().required(),
  DATABASE_URL: Joi.string().trim().required(),
  IDENTITY_BASE_URL: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .allow('')
    .optional(),
  IDENTITY_INTERNAL_TOKEN: Joi.string()
    .allow('')
    .optional(),
  IDENTITY_SIGNALS_TIMEOUT_MS: Joi.number().positive().optional(),
  AUTH_ACCESS_TOKEN_SECRET: Joi.string().min(16).required(),
  AUTH_ACCESS_TOKEN_TTL: Joi.string().trim().required(),
  AUTH_REFRESH_TOKEN_SECRET: Joi.string().min(16).required(),
  AUTH_REFRESH_TOKEN_TTL: Joi.string().trim().required(),
  RATE_LIMIT_TTL: Joi.number().positive().required(),
  RATE_LIMIT_LIMIT: Joi.number().positive().required(),
  SENSITIVE_RATE_LIMIT_TTL: Joi.number().positive().required(),
  SENSITIVE_RATE_LIMIT_LIMIT: Joi.number().positive().required(),
});
