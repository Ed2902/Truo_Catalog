-- Rewarded-ad unlock tracking for extra outgoing proposals and hidden incoming proposals.
CREATE TYPE "ExchangeProposalAdUnlockType" AS ENUM ('INCOMING_PROPOSAL_VIEW', 'OUTGOING_PROPOSAL_CREATE');

CREATE TABLE "ExchangeProposalAdUnlock" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "unlockType" "ExchangeProposalAdUnlockType" NOT NULL,
    "requestedItemId" TEXT,
    "proposalId" TEXT,
    "consumedByProposalId" TEXT,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExchangeProposalAdUnlock_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExchangeProposalAdUnlock_userId_unlockType_proposalId_key" ON "ExchangeProposalAdUnlock"("userId", "unlockType", "proposalId");
CREATE INDEX "ExchangeProposalAdUnlock_userId_unlockType_createdAt_idx" ON "ExchangeProposalAdUnlock"("userId", "unlockType", "createdAt");
CREATE INDEX "ExchangeProposalAdUnlock_userId_requestedItemId_unlockType_idx" ON "ExchangeProposalAdUnlock"("userId", "requestedItemId", "unlockType");
CREATE INDEX "ExchangeProposalAdUnlock_userId_unlockType_consumedAt_idx" ON "ExchangeProposalAdUnlock"("userId", "unlockType", "consumedAt");
