-- CreateEnum
CREATE TYPE "CatalogItemCondition" AS ENUM ('NEW', 'LIKE_NEW', 'USED_GOOD', 'USED_FAIR', 'FOR_PARTS');

-- CreateEnum
CREATE TYPE "CatalogItemPublicationStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'IN_NEGOTIATION', 'RESERVED', 'EXCHANGED', 'INACTIVE', 'BLOCKED');

-- CreateEnum
CREATE TYPE "ExchangeProposalStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'EXPIRED');

-- CreateTable
CREATE TABLE "CatalogCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "parentId" TEXT,
    "path" TEXT NOT NULL,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogItem" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "normalizedTitle" TEXT NOT NULL,
    "titleTokenSignature" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "normalizedDescription" TEXT,
    "categoryId" TEXT NOT NULL,
    "condition" "CatalogItemCondition" NOT NULL,
    "subjectiveValue" INTEGER,
    "exchangePreferences" TEXT,
    "publicationStatus" "CatalogItemPublicationStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "CatalogItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogItemImage" (
    "id" TEXT NOT NULL,
    "catalogItemId" TEXT NOT NULL,
    "storageUrl" TEXT NOT NULL,
    "storagePath" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isCover" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CatalogItemImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExchangeProposal" (
    "id" TEXT NOT NULL,
    "requesterUserId" TEXT NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "requestedItemId" TEXT NOT NULL,
    "offeredItemId" TEXT NOT NULL,
    "status" "ExchangeProposalStatus" NOT NULL DEFAULT 'PENDING',
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExchangeProposal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CatalogCategory_parentId_isActive_idx" ON "CatalogCategory"("parentId", "isActive");

-- CreateIndex
CREATE INDEX "CatalogCategory_path_idx" ON "CatalogCategory"("path");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogCategory_parentId_slug_key" ON "CatalogCategory"("parentId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogItem_slug_key" ON "CatalogItem"("slug");

-- CreateIndex
CREATE INDEX "CatalogItem_ownerUserId_publicationStatus_deletedAt_idx" ON "CatalogItem"("ownerUserId", "publicationStatus", "deletedAt");

-- CreateIndex
CREATE INDEX "CatalogItem_categoryId_publicationStatus_deletedAt_idx" ON "CatalogItem"("categoryId", "publicationStatus", "deletedAt");

-- CreateIndex
CREATE INDEX "CatalogItem_normalizedTitle_titleTokenSignature_idx" ON "CatalogItem"("normalizedTitle", "titleTokenSignature");

-- CreateIndex
CREATE INDEX "CatalogItemImage_catalogItemId_sortOrder_idx" ON "CatalogItemImage"("catalogItemId", "sortOrder");

-- CreateIndex
CREATE INDEX "ExchangeProposal_requesterUserId_status_idx" ON "ExchangeProposal"("requesterUserId", "status");

-- CreateIndex
CREATE INDEX "ExchangeProposal_targetUserId_status_idx" ON "ExchangeProposal"("targetUserId", "status");

-- CreateIndex
CREATE INDEX "ExchangeProposal_requestedItemId_status_idx" ON "ExchangeProposal"("requestedItemId", "status");

-- CreateIndex
CREATE INDEX "ExchangeProposal_offeredItemId_status_idx" ON "ExchangeProposal"("offeredItemId", "status");

-- AddForeignKey
ALTER TABLE "CatalogCategory" ADD CONSTRAINT "CatalogCategory_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "CatalogCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogItem" ADD CONSTRAINT "CatalogItem_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "CatalogCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogItemImage" ADD CONSTRAINT "CatalogItemImage_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "CatalogItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExchangeProposal" ADD CONSTRAINT "ExchangeProposal_requestedItemId_fkey" FOREIGN KEY ("requestedItemId") REFERENCES "CatalogItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExchangeProposal" ADD CONSTRAINT "ExchangeProposal_offeredItemId_fkey" FOREIGN KEY ("offeredItemId") REFERENCES "CatalogItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

