-- 赛事图片功能:新增 PHOTOGRAPHER 角色,以及照片、水印配置、操作日志三张表。

ALTER TABLE `user`
  MODIFY COLUMN `role` ENUM('SUPER_ADMIN', 'ADMIN', 'REFEREE', 'PLAYER', 'PHOTOGRAPHER') NOT NULL;

ALTER TABLE `invitecode`
  MODIFY COLUMN `role` ENUM('SUPER_ADMIN', 'ADMIN', 'REFEREE', 'PLAYER', 'PHOTOGRAPHER') NOT NULL;

CREATE TABLE `photo` (
  `id` VARCHAR(191) NOT NULL,
  `tournamentId` VARCHAR(191) NOT NULL,
  `uploaderId` VARCHAR(191) NOT NULL,
  `category` ENUM('PLAYER', 'MATCH', 'AWARD') NOT NULL,
  `originalPath` VARCHAR(500) NOT NULL,
  `watermarkPath` VARCHAR(500) NOT NULL,
  `thumbPath` VARCHAR(500) NOT NULL,
  `fileSize` INTEGER NOT NULL,
  `width` INTEGER NOT NULL,
  `height` INTEGER NOT NULL,
  `uploadedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `deletedAt` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  INDEX `photo_tournamentId_category_deletedAt_idx` (`tournamentId`, `category`, `deletedAt`),
  INDEX `photo_tournamentId_deletedAt_uploadedAt_idx` (`tournamentId`, `deletedAt`, `uploadedAt`),
  INDEX `photo_uploaderId_idx` (`uploaderId`),
  INDEX `photo_deletedAt_idx` (`deletedAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `tournamentwatermark` (
  `id` VARCHAR(191) NOT NULL,
  `tournamentId` VARCHAR(191) NOT NULL,
  `logos` JSON NOT NULL,
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `tournamentwatermark_tournamentId_key` (`tournamentId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `photooperationlog` (
  `id` VARCHAR(191) NOT NULL,
  `photoId` VARCHAR(191) NULL,
  `tournamentId` VARCHAR(191) NOT NULL,
  `operatorId` VARCHAR(191) NOT NULL,
  `operatorNameSnapshot` VARCHAR(64) NULL,
  `action` VARCHAR(32) NOT NULL,
  `detail` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `photooperationlog_tournamentId_createdAt_idx` (`tournamentId`, `createdAt`),
  INDEX `photooperationlog_operatorId_idx` (`operatorId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `photo`
  ADD CONSTRAINT `photo_tournamentId_fkey` FOREIGN KEY (`tournamentId`) REFERENCES `tournament`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `photo`
  ADD CONSTRAINT `photo_uploaderId_fkey` FOREIGN KEY (`uploaderId`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `tournamentwatermark`
  ADD CONSTRAINT `tournamentwatermark_tournamentId_fkey` FOREIGN KEY (`tournamentId`) REFERENCES `tournament`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `photooperationlog`
  ADD CONSTRAINT `photooperationlog_operatorId_fkey` FOREIGN KEY (`operatorId`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
