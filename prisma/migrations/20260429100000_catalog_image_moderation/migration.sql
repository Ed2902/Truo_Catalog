-- Add under-review publication state.
ALTER TYPE "CatalogItemPublicationStatus" ADD VALUE IF NOT EXISTS 'UNDER_REVIEW';

-- CreateEnum
CREATE TYPE "CatalogImageModerationStatus" AS ENUM ('PENDING', 'APPROVED', 'NEEDS_REVIEW', 'BLOCKED', 'ERROR');

-- CreateEnum
CREATE TYPE "CatalogImageModerationRiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "CatalogImageModerationRecommendedAction" AS ENUM ('APPROVE', 'KEEP_VISIBLE', 'SEND_TO_REVIEW', 'REMOVE_PRODUCT');

-- CreateEnum
CREATE TYPE "CatalogModerationAppealStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "CatalogItemImageModeration" (
    "id" TEXT NOT NULL,
    "catalogItemId" TEXT NOT NULL,
    "catalogItemImageId" TEXT,
    "jobId" TEXT NOT NULL,
    "status" "CatalogImageModerationStatus" NOT NULL DEFAULT 'PENDING',
    "detectedProductType" TEXT,
    "isProhibited" BOOLEAN,
    "riskLevel" "CatalogImageModerationRiskLevel",
    "confidence" DOUBLE PRECISION,
    "flags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "recommendedAction" "CatalogImageModerationRecommendedAction",
    "rawResult" JSONB,
    "errorMessage" TEXT,
    "analyzedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "reviewedByUserId" TEXT,
    "reviewNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogItemImageModeration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogModerationAppeal" (
    "id" TEXT NOT NULL,
    "catalogItemId" TEXT NOT NULL,
    "moderationId" TEXT,
    "ownerUserId" TEXT NOT NULL,
    "status" "CatalogModerationAppealStatus" NOT NULL DEFAULT 'PENDING',
    "message" TEXT NOT NULL,
    "resolutionMessage" TEXT,
    "resolvedByUserId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogModerationAppeal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CatalogItemImageModeration_jobId_key" ON "CatalogItemImageModeration"("jobId");

-- CreateIndex
CREATE INDEX "CatalogItemImageModeration_catalogItemId_status_idx" ON "CatalogItemImageModeration"("catalogItemId", "status");

-- CreateIndex
CREATE INDEX "CatalogItemImageModeration_catalogItemImageId_idx" ON "CatalogItemImageModeration"("catalogItemImageId");

-- CreateIndex
CREATE INDEX "CatalogItemImageModeration_status_createdAt_idx" ON "CatalogItemImageModeration"("status", "createdAt");

-- CreateIndex
CREATE INDEX "CatalogModerationAppeal_catalogItemId_status_idx" ON "CatalogModerationAppeal"("catalogItemId", "status");

-- CreateIndex
CREATE INDEX "CatalogModerationAppeal_ownerUserId_status_idx" ON "CatalogModerationAppeal"("ownerUserId", "status");

-- CreateIndex
CREATE INDEX "CatalogModerationAppeal_status_createdAt_idx" ON "CatalogModerationAppeal"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "CatalogItemImageModeration" ADD CONSTRAINT "CatalogItemImageModeration_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "CatalogItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogItemImageModeration" ADD CONSTRAINT "CatalogItemImageModeration_catalogItemImageId_fkey" FOREIGN KEY ("catalogItemImageId") REFERENCES "CatalogItemImage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogModerationAppeal" ADD CONSTRAINT "CatalogModerationAppeal_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "CatalogItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogModerationAppeal" ADD CONSTRAINT "CatalogModerationAppeal_moderationId_fkey" FOREIGN KEY ("moderationId") REFERENCES "CatalogItemImageModeration"("id") ON DELETE SET NULL ON UPDATE CASCADE;
