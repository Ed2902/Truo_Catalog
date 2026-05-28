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
- Catalog image moderation persistence, review queue, blocked item history, user reports, and appeals

## Run

```bash
npm install
npm run start:dev
```

Copy `.env.example` to `.env` and adjust values before starting the app.

## Image Moderation

When a catalog image is confirmed or attached directly to an item, Catalog calls the image analyzer worker and stores the result in PostgreSQL. The item status is updated from the worker recommendation:

- `APPROVE` / `KEEP_VISIBLE` keeps the item visible when it was already publishable.
- `SEND_TO_REVIEW` moves the item to `UNDER_REVIEW`.
- `REMOVE_PRODUCT` moves the item to `BLOCKED`.
- Worker errors are stored as moderation `ERROR` and the item moves to `UNDER_REVIEW`.
- Editing visible item content, including text or images, moves the item back to `UNDER_REVIEW` and re-runs image moderation before it can become public again.

Required local worker configuration:

```env
IMAGE_ANALYZER_WORKER_URL="http://localhost:8001"
IMAGE_ANALYZER_TIMEOUT_MS="15000"
MODERATION_INTERNAL_TOKEN="change-me-moderation-internal-token"
```

User appeal endpoints:

- `POST /api/catalog/moderation/items/:itemId/appeals`
- `GET /api/catalog/moderation/items/:itemId/appeals`

User report endpoint:

- `POST /api/catalog/moderation/items/:itemId/reports`

Reports are for third-party users who find a public item that may have passed automated moderation by mistake. A report does not automatically block the item; it creates an internal review task that can be dismissed, sent to review, or actioned by removing the item.

Trash and restore endpoints:

- `DELETE /api/catalog/items/:itemId` moves the item to trash for 5 days.
- `GET /api/catalog/items/me/trash` lists the authenticated user's recoverable trashed items.
- `POST /api/catalog/items/:itemId/restore` restores a trashed item and sends it back through image moderation before it can become public.

Internal human-review endpoints, protected with `x-internal-token` or `Authorization: Bearer <MODERATION_INTERNAL_TOKEN>`:

- `GET /api/catalog/moderation/internal/reviews`
- `GET /api/catalog/moderation/internal/blocked`
- `GET /api/catalog/moderation/internal/reports`
- `POST /api/catalog/moderation/internal/reports/:reportId/resolve`
- `POST /api/catalog/moderation/internal/reviews/:moderationId/resolve`
- `GET /api/catalog/moderation/internal/appeals`
- `POST /api/catalog/moderation/internal/appeals/:appealId/resolve`
