/*
  Warnings:

  - You are about to drop the `ExchangeChat` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ExchangeChatAttachment` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ExchangeChatMessage` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "ExchangeChat" DROP CONSTRAINT "ExchangeChat_matchId_fkey";

-- DropForeignKey
ALTER TABLE "ExchangeChatAttachment" DROP CONSTRAINT "ExchangeChatAttachment_chatId_fkey";

-- DropForeignKey
ALTER TABLE "ExchangeChatAttachment" DROP CONSTRAINT "ExchangeChatAttachment_messageId_fkey";

-- DropForeignKey
ALTER TABLE "ExchangeChatMessage" DROP CONSTRAINT "ExchangeChatMessage_chatId_fkey";

-- DropTable
DROP TABLE "ExchangeChat";

-- DropTable
DROP TABLE "ExchangeChatAttachment";

-- DropTable
DROP TABLE "ExchangeChatMessage";

-- DropEnum
DROP TYPE "ExchangeChatAttachmentStatus";

-- DropEnum
DROP TYPE "ExchangeChatAttachmentType";

-- DropEnum
DROP TYPE "ExchangeChatMessageStatus";

-- DropEnum
DROP TYPE "ExchangeChatMessageType";

-- DropEnum
DROP TYPE "ExchangeChatStatus";
