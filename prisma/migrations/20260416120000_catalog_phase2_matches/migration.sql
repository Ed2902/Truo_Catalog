-- CreateEnum
CREATE TYPE "ExchangeMatchStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'CANCELLED', 'NOT_CONCRETED', 'EXPIRED');

-- CreateTable
CREATE TABLE "ExchangeMatch" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "requesterUserId" TEXT NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "requestedItemId" TEXT NOT NULL,
    "offeredItemId" TEXT NOT NULL,
    "status" "ExchangeMatchStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "closedByUserId" TEXT,
    "closeReason" TEXT,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "ExchangeMatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExchangeMatch_proposalId_key" ON "ExchangeMatch"("proposalId");

-- CreateIndex
CREATE INDEX "ExchangeMatch_requesterUserId_status_idx" ON "ExchangeMatch"("requesterUserId", "status");

-- CreateIndex
CREATE INDEX "ExchangeMatch_targetUserId_status_idx" ON "ExchangeMatch"("targetUserId", "status");

-- CreateIndex
CREATE INDEX "ExchangeMatch_requestedItemId_status_idx" ON "ExchangeMatch"("requestedItemId", "status");

-- CreateIndex
CREATE INDEX "ExchangeMatch_offeredItemId_status_idx" ON "ExchangeMatch"("offeredItemId", "status");

-- AddForeignKey
ALTER TABLE "ExchangeMatch" ADD CONSTRAINT "ExchangeMatch_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "ExchangeProposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExchangeMatch" ADD CONSTRAINT "ExchangeMatch_requestedItemId_fkey" FOREIGN KEY ("requestedItemId") REFERENCES "CatalogItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExchangeMatch" ADD CONSTRAINT "ExchangeMatch_offeredItemId_fkey" FOREIGN KEY ("offeredItemId") REFERENCES "CatalogItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
