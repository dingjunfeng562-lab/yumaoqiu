CREATE TABLE `MatchCheckIn` (
  `matchId` VARCHAR(191) NOT NULL,
  `side` INTEGER NOT NULL,
  `entrantKey` VARCHAR(64) NOT NULL,
  `checkedAt` DATETIME(3) NOT NULL,
  `actorId` VARCHAR(191) NOT NULL,
  PRIMARY KEY (`matchId`, `side`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `MatchCheckInLog` (
  `id` VARCHAR(191) NOT NULL,
  `matchId` VARCHAR(191) NOT NULL,
  `side` INTEGER NOT NULL,
  `entrantKey` VARCHAR(64) NOT NULL,
  `action` VARCHAR(16) NOT NULL,
  `actorId` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `MatchCheckInLog_matchId_createdAt_idx` (`matchId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `MatchCheckIn` ADD CONSTRAINT `MatchCheckIn_matchId_fkey`
  FOREIGN KEY (`matchId`) REFERENCES `Match`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `MatchCheckInLog` ADD CONSTRAINT `MatchCheckInLog_matchId_fkey`
  FOREIGN KEY (`matchId`) REFERENCES `Match`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
