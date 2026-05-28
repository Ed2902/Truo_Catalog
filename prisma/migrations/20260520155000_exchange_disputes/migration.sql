-- CreateEnum
CREATE TYPE "ExchangeDisputeStatus" AS ENUM ('OPEN', 'IN_REVIEW', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ExchangeDisputeReason" AS ENUM ('ITEM_NOT_AS_DESCRIBED', 'NO_SHOW', 'SAFETY_CONCERN', 'DELIVERY_OR_HANDOFF', 'HARASSMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "ExchangeDisputeMessageSenderType" AS ENUM ('USER', 'ADMIN', 'SYSTEM');

-- CreateTable
CREATE TABLE "ExchangeDispute" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "proposalId" TEXT,
    "openedByUserId" TEXT NOT NULL,
    "requesterUserId" TEXT NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "requestedItemId" TEXT NOT NULL,
    "offeredItemId" TEXT NOT NULL,
    "status" "ExchangeDisputeStatus" NOT NULL DEFAULT 'OPEN',
    "reason" "ExchangeDisputeReason" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "resolution" TEXT,
    "assignedAdminUserId" TEXT,
    "resolvedByAdminUserId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExchangeDispute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExchangeDisputeMessage" (
    "id" TEXT NOT NULL,
    "disputeId" TEXT NOT NULL,
    "senderType" "ExchangeDisputeMessageSenderType" NOT NULL,
    "senderUserId" TEXT,
    "senderAdminUserId" TEXT,
    "text" TEXT NOT NULL,
    "isInternalNote" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExchangeDisputeMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExchangeDispute_matchId_status_idx" ON "ExchangeDispute"("matchId", "status");

-- CreateIndex
CREATE INDEX "ExchangeDispute_requesterUserId_status_idx" ON "ExchangeDispute"("requesterUserId", "status");

-- CreateIndex
CREATE INDEX "ExchangeDispute_targetUserId_status_idx" ON "ExchangeDispute"("targetUserId", "status");

-- CreateIndex
CREATE INDEX "ExchangeDispute_openedByUserId_status_idx" ON "ExchangeDispute"("openedByUserId", "status");

-- CreateIndex
CREATE INDEX "ExchangeDispute_status_updatedAt_idx" ON "ExchangeDispute"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "ExchangeDisputeMessage_disputeId_createdAt_idx" ON "ExchangeDisputeMessage"("disputeId", "createdAt");

-- CreateIndex
CREATE INDEX "ExchangeDisputeMessage_senderUserId_createdAt_idx" ON "ExchangeDisputeMessage"("senderUserId", "createdAt");

-- CreateIndex
CREATE INDEX "ExchangeDisputeMessage_senderAdminUserId_createdAt_idx" ON "ExchangeDisputeMessage"("senderAdminUserId", "createdAt");

-- AddForeignKey
ALTER TABLE "ExchangeDispute" ADD CONSTRAINT "ExchangeDispute_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "ExchangeMatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExchangeDispute" ADD CONSTRAINT "ExchangeDispute_requestedItemId_fkey" FOREIGN KEY ("requestedItemId") REFERENCES "CatalogItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExchangeDispute" ADD CONSTRAINT "ExchangeDispute_offeredItemId_fkey" FOREIGN KEY ("offeredItemId") REFERENCES "CatalogItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExchangeDisputeMessage" ADD CONSTRAINT "ExchangeDisputeMessage_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "ExchangeDispute"("id") ON DELETE CASCADE ON UPDATE CASCADE;
