CREATE TABLE `referee_tournament_access_code` (
  `tournamentId` VARCHAR(191) NOT NULL,
  `token` VARCHAR(64) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`tournamentId`),
  UNIQUE INDEX `referee_tournament_access_code_token_key` (`token`),
  CONSTRAINT `referee_access_code_tournament_fkey` FOREIGN KEY (`tournamentId`) REFERENCES `Tournament` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `referee_tournament_grant` (
  `tournamentId` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `grantedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`tournamentId`, `userId`),
  INDEX `referee_tournament_grant_userId_idx` (`userId`),
  CONSTRAINT `referee_grant_tournament_fkey` FOREIGN KEY (`tournamentId`) REFERENCES `Tournament` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `referee_grant_user_fkey` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
