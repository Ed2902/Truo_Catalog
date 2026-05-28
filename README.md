# Catalog API

Base project for `Catalog_api` built from the shared NestJS infrastructure used in `Identity_api`.

Catalog Phase 1 implementation details are documented in `docs/catalog-phase-1.md`.

## Included

- Global config with environment validation
- Request context middleware with `x-request-id`
- Global logger with `nestjs-pino`
- Helmet, CORS and validation pipe
- Global rate limiting with proxy-aware tracking
- Liveness and readiness endpoints

## Run

```bash
npm install
npm run start:dev
```

Copy `.env.example` to `.env` and adjust values before starting the app.
