-- Track per-participant reminders for post-Truo physical confirmation.
CREATE TABLE "ExchangeMatchFeedbackReminder" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reminderCount" INTEGER NOT NULL DEFAULT 0,
    "lastSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExchangeMatchFeedbackReminder_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExchangeMatchFeedbackReminder_matchId_userId_key" ON "ExchangeMatchFeedbackReminder"("matchId", "userId");
CREATE INDEX "ExchangeMatchFeedbackReminder_userId_lastSentAt_idx" ON "ExchangeMatchFeedbackReminder"("userId", "lastSentAt");
CREATE INDEX "ExchangeMatchFeedbackReminder_lastSentAt_idx" ON "ExchangeMatchFeedbackReminder"("lastSentAt");

ALTER TABLE "ExchangeMatchFeedbackReminder" ADD CONSTRAINT "ExchangeMatchFeedbackReminder_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "ExchangeMatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
