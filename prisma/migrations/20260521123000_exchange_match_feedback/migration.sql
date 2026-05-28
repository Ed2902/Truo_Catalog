-- Post-Truo confirmation and participant rating.
CREATE TABLE "ExchangeMatchFeedback" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "reviewerUserId" TEXT NOT NULL,
    "reviewedUserId" TEXT NOT NULL,
    "wasEffectiveInPerson" BOOLEAN NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExchangeMatchFeedback_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExchangeMatchFeedback_matchId_reviewerUserId_key" ON "ExchangeMatchFeedback"("matchId", "reviewerUserId");
CREATE INDEX "ExchangeMatchFeedback_reviewedUserId_rating_idx" ON "ExchangeMatchFeedback"("reviewedUserId", "rating");
CREATE INDEX "ExchangeMatchFeedback_wasEffectiveInPerson_createdAt_idx" ON "ExchangeMatchFeedback"("wasEffectiveInPerson", "createdAt");

ALTER TABLE "ExchangeMatchFeedback" ADD CONSTRAINT "ExchangeMatchFeedback_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "ExchangeMatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
