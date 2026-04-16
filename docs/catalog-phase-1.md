# Catalog Phase 1

## Estado Inicial Encontrado

- El repositorio solo tenía infraestructura base de NestJS.
- No existían módulos de catálogo, persistencia, entidades ni endpoints de negocio.
- No existía integración de `Catalog` con señales de `Identity`.

## Modelos Nuevos

### `CatalogCategory`

- Categorías jerárquicas con `parentId`, `path` y `depth`.
- Permite crecer de categoría principal a subcategorías y más niveles sin lista plana rígida.
- Se permite un máximo de `5` niveles.
- Los niveles no son obligatorios.

### `CatalogItem`

- Publicación principal del catálogo.
- Incluye:
  - `id`
  - `ownerUserId`
  - `title`
  - `normalizedTitle`
  - `titleTokenSignature`
  - `slug`
  - `description`
  - `normalizedDescription`
  - `categoryId`
  - `condition`
  - `subjectiveValue`
  - `exchangePreferences`
  - `publicationStatus`
  - `publishedAt`
  - `createdAt`
  - `updatedAt`
  - `deletedAt`

### `CatalogItemImage`

- Soporte de múltiples imágenes por producto.
- Incluye:
  - `id`
  - `catalogItemId`
  - `storageUrl`
  - `storagePath`
  - `sortOrder`
  - `isCover`
  - `createdAt`

### `ExchangeProposal`

- Base de propuestas formales de trueque.
- Incluye:
  - `id`
  - `requesterUserId`
  - `targetUserId`
  - `requestedItemId`
  - `offeredItemId`
  - `status`
  - `message`
  - `createdAt`
  - `updatedAt`

## Enums Nuevos

- `CatalogItemCondition`
  - `NEW`
  - `LIKE_NEW`
  - `USED_GOOD`
  - `USED_FAIR`
  - `FOR_PARTS`
- `CatalogItemPublicationStatus`
  - `DRAFT`
  - `ACTIVE`
  - `PAUSED`
  - `IN_NEGOTIATION`
  - `RESERVED`
  - `EXCHANGED`
  - `INACTIVE`
  - `BLOCKED`
- `ExchangeProposalStatus`
  - `PENDING`
  - `ACCEPTED`
  - `REJECTED`
  - `CANCELLED`
  - `EXPIRED`

## Endpoints Implementados

### Categorías

- `POST /api/catalog/categories`
- `GET /api/catalog/categories`

### Productos / publicaciones

- `POST /api/catalog/items`
- `PATCH /api/catalog/items/:itemId`
- `GET /api/catalog/items/me`
- `GET /api/catalog/items`
- `GET /api/catalog/items/:itemId`

### Propuestas de trueque

- `POST /api/catalog/exchange-proposals`
- `GET /api/catalog/exchange-proposals/me`
- `POST /api/catalog/exchange-proposals/:proposalId/accept`
- `POST /api/catalog/exchange-proposals/:proposalId/reject`
- `POST /api/catalog/exchange-proposals/:proposalId/cancel`

## Reglas de Negocio Implementadas

### No hay chat libre

- No se creó chat.
- No se abre ninguna conversación al crear propuesta.
- Cuando una propuesta se acepta, la respuesta marca `matchReady: true` y `matchStatus: "PENDING_IMPLEMENTATION"` como punto de extensión para Fase 2.

### Límite free/premium por producto

- Regla centralizada en `CatalogNegotiationPolicyService`.
- Estados que hoy ocupan cupo:
  - `PENDING`
  - `ACCEPTED`
- Usuario premium:
  - negociaciones activas ilimitadas por producto
- Usuario free:
  - máximo `3` negociaciones activas por producto
- Si la propuesta se `REJECTED` o `CANCELLED`, libera cupo automáticamente al salir de estados activos.

### Prevención de productos repetidos

- Regla centralizada en `CatalogDuplicatePolicyService`.
- En Fase 1 se aplica a usuarios free.
- La barrera actual revisa:
  - mismo `ownerUserId`
  - misma `categoryId`
  - misma `condition`
  - título normalizado o firma de tokens equivalente

### Estados del producto

- La estructura completa de estados quedó modelada desde el inicio.
- En esta fase se sincroniza `IN_NEGOTIATION` cuando existe al menos una propuesta aceptada viva.
- Si el producto ya no tiene propuestas aceptadas vivas, puede volver a `ACTIVE`.

### Gobierno de categorías

- Las categorías no las crean los usuarios finales.
- Los usuarios solo consumen la taxonomía existente para clasificar sus productos.
- La creación de categorías en esta etapa queda protegida con JWT autenticado.
- Cuando `Identity` exponga rol/claim administrativo, esta ruta debe endurecerse a solo administración/backoffice.
- La taxonomía permite hasta `5` niveles.

## Integración con Identity

- `Catalog` no duplica premium.
- La lectura de señales vive en `IdentitySignalsService`.
- Prioridad de resolución:
  - JWT `Bearer` firmado con la misma clave de acceso usada por `Identity`
  - consulta a `GET /api/users/me` en `Identity` para validar el actor autenticado y resolver premium
  - endpoint HTTP interno de `Identity` si se configura `IDENTITY_BASE_URL` para consultar señales de terceros
  - cache opcional `x-identity-signals-cache` solo fuera de producción para pruebas locales
  - fallback local no premium solo si no existe integración configurada para señales de terceros

## Seguridad HTTP

- Endpoints autenticados del actor:
  - `Authorization: Bearer <access_token>`
- Señales de terceros en pruebas locales no productivas:
  - `x-identity-signals-cache`
- Controles activos:
  - `helmet`
  - `ValidationPipe` global con `whitelist` y `forbidNonWhitelisted`
  - rate limiting global y sensible
  - redacción en logs de `authorization`, `cookie` y `x-internal-token`
  - sanitización backend de texto plano para títulos, descripciones, preferencias, mensajes y nombres de categoría

## Header de desarrollo opcional

```json
{
  "user-1": { "isPremium": true },
  "user-2": { "isPremium": false }
}
```

## Persistencia

- Se agregó `Prisma` como base de persistencia.
- El modelo vive en `prisma/schema.prisma`.
- La migración inicial de Fase 1 vive en:
  - `prisma/migrations/20260416000000_catalog_phase1_init/migration.sql`

## Qué Quedó Listo

- Base estructural del catálogo.
- Publicaciones con imágenes múltiples.
- Categorías jerárquicas.
- Propuestas formales de trueque.
- Política central de límite free/premium por producto.
- Validación de repetidos para usuarios free.
- Endpoints mínimos para operar Fase 1.

## Qué Queda Preparado para Fase 2

- Match formal al aceptar propuesta.
- Apertura de chat solo después de match.
- Home/ranking y visibilidad sobre catálogo ya estructurado.
- Políticas más finas para disponibilidad, expiración y negociación avanzada.
- Mejora de detección de duplicados con señales más fuertes o IA.
