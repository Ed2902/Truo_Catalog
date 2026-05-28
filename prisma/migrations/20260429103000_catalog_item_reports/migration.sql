-- CreateEnum
CREATE TYPE "CatalogItemReportReason" AS ENUM ('PROHIBITED_CONTENT', 'EXTERNAL_CONTACT', 'MISLEADING_PRODUCT', 'SCAM_OR_FRAUD', 'DUPLICATE', 'OTHER');

-- CreateEnum
CREATE TYPE "CatalogItemReportStatus" AS ENUM ('PENDING', 'DISMISSED', 'SENT_TO_REVIEW', 'ACTIONED');

-- CreateTable
CREATE TABLE "CatalogItemReport" (
    "id" TEXT NOT NULL,
    "catalogItemId" TEXT NOT NULL,
    "reporterUserId" TEXT NOT NULL,
    "reason" "CatalogItemReportReason" NOT NULL,
    "details" TEXT,
    "status" "CatalogItemReportStatus" NOT NULL DEFAULT 'PENDING',
    "resolutionNotes" TEXT,
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogItemReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CatalogItemReport_catalogItemId_status_idx" ON "CatalogItemReport"("catalogItemId", "status");

-- CreateIndex
CREATE INDEX "CatalogItemReport_reporterUserId_status_idx" ON "CatalogItemReport"("reporterUserId", "status");

-- CreateIndex
CREATE INDEX "CatalogItemReport_status_createdAt_idx" ON "CatalogItemReport"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "CatalogItemReport" ADD CONSTRAINT "CatalogItemReport_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "CatalogItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
