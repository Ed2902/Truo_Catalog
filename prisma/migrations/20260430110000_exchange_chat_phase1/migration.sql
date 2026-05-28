CREATE TYPE "ExchangeChatStatus" AS ENUM ('ACTIVE', 'CLOSED', 'TRASHED', 'DELETED');

CREATE TYPE "ExchangeChatMessageType" AS ENUM ('TEXT', 'IMAGE', 'VIDEO', 'AUDIO', 'SYSTEM');

CREATE TYPE "ExchangeChatMessageStatus" AS ENUM ('ACTIVE', 'UNDER_REVIEW', 'BLOCKED', 'DELETED');

CREATE TYPE "ExchangeChatAttachmentType" AS ENUM ('IMAGE', 'VIDEO', 'AUDIO');

CREATE TYPE "ExchangeChatAttachmentStatus" AS ENUM ('PENDING', 'READY', 'ATTACHED', 'DELETED');

CREATE TABLE "ExchangeChat" (
  "id" TEXT NOT NULL,
  "matchId" TEXT NOT NULL,
  "requesterUserId" TEXT NOT NULL,
  "targetUserId" TEXT NOT NULL,
  "status" "ExchangeChatStatus" NOT NULL DEFAULT 'ACTIVE',
  "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastInteractionAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closesAt" TIMESTAMP(3) NOT NULL,
  "trashAt" TIMESTAMP(3) NOT NULL,
  "deleteAt" TIMESTAMP(3) NOT NULL,
  "closedAt" TIMESTAMP(3),
  "trashedAt" TIMESTAMP(3),
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ExchangeChat_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExchangeChatMessage" (
  "id" TEXT NOT NULL,
  "chatId" TEXT NOT NULL,
  "senderUserId" TEXT NOT NULL,
  "recipientUserId" TEXT NOT NULL,
  "type" "ExchangeChatMessageType" NOT NULL,
  "status" "ExchangeChatMessageStatus" NOT NULL DEFAULT 'ACTIVE',
  "text" TEXT,
  "receivedAt" TIMESTAMP(3),
  "readAt" TIMESTAMP(3),
  "moderationFlags" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "moderationFindings" JSONB,
  "moderationRiskLevel" TEXT,
  "moderationAction" TEXT,
  "blockedReason" TEXT,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ExchangeChatMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExchangeChatAttachment" (
  "id" TEXT NOT NULL,
  "chatId" TEXT NOT NULL,
  "messageId" TEXT,
  "uploaderUserId" TEXT NOT NULL,
  "type" "ExchangeChatAttachmentType" NOT NULL,
  "status" "ExchangeChatAttachmentStatus" NOT NULL DEFAULT 'PENDING',
  "fileName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "durationMs" INTEGER,
  "width" INTEGER,
  "height" INTEGER,
  "storagePath" TEXT NOT NULL,
  "storageUrl" TEXT NOT NULL,
  "confirmedAt" TIMESTAMP(3),
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ExchangeChatAttachment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExchangeChat_matchId_key" ON "ExchangeChat"("matchId");
CREATE INDEX "ExchangeChat_requesterUserId_status_idx" ON "ExchangeChat"("requesterUserId", "status");
CREATE INDEX "ExchangeChat_targetUserId_status_idx" ON "ExchangeChat"("targetUserId", "status");
CREATE INDEX "ExchangeChat_status_deleteAt_idx" ON "ExchangeChat"("status", "deleteAt");

CREATE INDEX "ExchangeChatMessage_chatId_createdAt_idx" ON "ExchangeChatMessage"("chatId", "createdAt");
CREATE INDEX "ExchangeChatMessage_recipientUserId_readAt_status_idx" ON "ExchangeChatMessage"("recipientUserId", "readAt", "status");
CREATE INDEX "ExchangeChatMessage_status_createdAt_idx" ON "ExchangeChatMessage"("status", "createdAt");

CREATE INDEX "ExchangeChatAttachment_chatId_status_createdAt_idx" ON "ExchangeChatAttachment"("chatId", "status", "createdAt");
CREATE INDEX "ExchangeChatAttachment_messageId_idx" ON "ExchangeChatAttachment"("messageId");
CREATE INDEX "ExchangeChatAttachment_uploaderUserId_status_idx" ON "ExchangeChatAttachment"("uploaderUserId", "status");

ALTER TABLE "ExchangeChat"
ADD CONSTRAINT "ExchangeChat_matchId_fkey"
FOREIGN KEY ("matchId") REFERENCES "ExchangeMatch"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ExchangeChatMessage"
ADD CONSTRAINT "ExchangeChatMessage_chatId_fkey"
FOREIGN KEY ("chatId") REFERENCES "ExchangeChat"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ExchangeChatAttachment"
ADD CONSTRAINT "ExchangeChatAttachment_chatId_fkey"
FOREIGN KEY ("chatId") REFERENCES "ExchangeChat"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ExchangeChatAttachment"
ADD CONSTRAINT "ExchangeChatAttachment_messageId_fkey"
FOREIGN KEY ("messageId") REFERENCES "ExchangeChatMessage"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
