-- 比赛结束签字确认：赛事级开关 + 电子比分单。
-- 只新增列和表，不改动已有数据；旧代码遇到新列/新表也能照常运行。

ALTER TABLE `Tournament` ADD COLUMN `requireMatchSignature` BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE `MatchScoreSheet` (
  `id` VARCHAR(32) NOT NULL,
  `matchId` VARCHAR(191) NOT NULL,
  `tournamentId` VARCHAR(191) NOT NULL,
  `endType` VARCHAR(16) NOT NULL,
  `winnerSide` INTEGER NULL,
  `winnerSignerIndex` INTEGER NULL,
  `winnerSignerName` VARCHAR(100) NULL,
  `winnerSignaturePath` VARCHAR(255) NULL,
  `winnerSignatureSha256` CHAR(64) NULL,
  `refereeId` VARCHAR(191) NULL,
  `refereeName` VARCHAR(100) NOT NULL,
  `refereeSignaturePath` VARCHAR(255) NOT NULL,
  `refereeSignatureSha256` CHAR(64) NOT NULL,
  `sheetPath` VARCHAR(255) NULL,
  `sheetSha256` CHAR(64) NULL,
  `snapshot` JSON NOT NULL,
  `contentHash` CHAR(64) NOT NULL,
  `matchFinishedAt` DATETIME(3) NULL,
  `clientIp` VARCHAR(64) NULL,
  `userAgent` VARCHAR(255) NULL,
  `signedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `status` ENUM('VALID', 'VOID') NOT NULL DEFAULT 'VALID',
  `voidedAt` DATETIME(3) NULL,
  `voidReason` VARCHAR(191) NULL,
  `voidedById` VARCHAR(191) NULL,
  INDEX `MatchScoreSheet_matchId_signedAt_idx` (`matchId`, `signedAt`),
  INDEX `MatchScoreSheet_tournamentId_signedAt_idx` (`tournamentId`, `signedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `MatchScoreSheet` ADD CONSTRAINT `MatchScoreSheet_matchId_fkey`
  FOREIGN KEY (`matchId`) REFERENCES `Match`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
