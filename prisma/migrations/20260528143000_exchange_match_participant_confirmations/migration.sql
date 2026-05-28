CREATE TABLE "ExchangeMatchParticipantConfirmation" (
  "id" TEXT NOT NULL,
  "matchId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "confirmedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ExchangeMatchParticipantConfirmation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExchangeMatchParticipantConfirmation_matchId_userId_key"
ON "ExchangeMatchParticipantConfirmation"("matchId", "userId");

CREATE INDEX "ExchangeMatchParticipantConfirmation_userId_confirmedAt_idx"
ON "ExchangeMatchParticipantConfirmation"("userId", "confirmedAt");

CREATE INDEX "ExchangeMatchParticipantConfirmation_matchId_confirmedAt_idx"
ON "ExchangeMatchParticipantConfirmation"("matchId", "confirmedAt");

ALTER TABLE "ExchangeMatchParticipantConfirmation"
ADD CONSTRAINT "ExchangeMatchParticipantConfirmation_matchId_fkey"
FOREIGN KEY ("matchId") REFERENCES "ExchangeMatch"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
