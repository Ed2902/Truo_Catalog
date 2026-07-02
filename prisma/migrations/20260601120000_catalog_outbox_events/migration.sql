CREATE TYPE "CatalogOutboxEventStatus" AS ENUM ('PENDING', 'PROCESSING', 'PROCESSED', 'FAILED');

CREATE TABLE "CatalogOutboxEvent" (
    "id" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "aggregateType" TEXT,
    "aggregateId" TEXT,
    "payload" JSONB NOT NULL,
    "status" "CatalogOutboxEventStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogOutboxEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CatalogOutboxEvent_status_nextAttemptAt_idx" ON "CatalogOutboxEvent"("status", "nextAttemptAt");
CREATE INDEX "CatalogOutboxEvent_topic_createdAt_idx" ON "CatalogOutboxEvent"("topic", "createdAt");
CREATE INDEX "CatalogOutboxEvent_aggregateType_aggregateId_idx" ON "CatalogOutboxEvent"("aggregateType", "aggregateId");
