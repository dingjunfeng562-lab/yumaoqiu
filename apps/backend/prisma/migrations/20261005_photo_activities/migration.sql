CREATE TABLE `PhotoActivity` (
  `id` VARCHAR(191) NOT NULL,
  `title` VARCHAR(120) NOT NULL,
  `coverImageUrl` VARCHAR(500) NULL,
  `dateMode` VARCHAR(8) NOT NULL DEFAULT 'SINGLE',
  `startAt` DATETIME(3) NOT NULL,
  `endAt` DATETIME(3) NULL,
  `approvalStatus` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
  `submittedById` VARCHAR(191) NULL,
  `approvedById` VARCHAR(191) NULL,
  `approvedAt` DATETIME(3) NULL,
  `rejectReason` VARCHAR(500) NULL,
  `photoAccessToken` VARCHAR(64) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `PhotoActivity_photoAccessToken_key`(`photoAccessToken`),
  INDEX `PhotoActivity_submittedById_createdAt_idx`(`submittedById`, `createdAt`),
  INDEX `PhotoActivity_approvalStatus_createdAt_idx`(`approvalStatus`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PhotoActivityWatermark` (
  `id` VARCHAR(191) NOT NULL,
  `activityId` VARCHAR(191) NOT NULL,
  `logos` JSON NOT NULL,
  `logoHeightPercent` INTEGER NOT NULL DEFAULT 8,
  `logoGapPercent` INTEGER NOT NULL DEFAULT 20,
  `position` VARCHAR(16) NOT NULL DEFAULT 'TOP_RIGHT',
  `portraitPosition` VARCHAR(16) NULL,
  `text` VARCHAR(100) NULL,
  `textColor` VARCHAR(16) NULL,
  `textSizePercent` INTEGER NULL,
  `textFont` VARCHAR(32) NULL,
  `textPosition` VARCHAR(16) NULL,
  `textPortraitPosition` VARCHAR(16) NULL,
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `PhotoActivityWatermark_activityId_key`(`activityId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `Photo`
  MODIFY `tournamentId` VARCHAR(191) NULL,
  ADD COLUMN `activityId` VARCHAR(191) NULL,
  ADD INDEX `Photo_activityId_category_deletedAt_idx`(`activityId`, `category`, `deletedAt`),
  ADD INDEX `Photo_activityId_deletedAt_uploadedAt_idx`(`activityId`, `deletedAt`, `uploadedAt`);

ALTER TABLE `PhotoOperationLog`
  MODIFY `tournamentId` VARCHAR(191) NULL,
  ADD COLUMN `activityId` VARCHAR(191) NULL,
  ADD INDEX `PhotoOperationLog_activityId_createdAt_idx`(`activityId`, `createdAt`);

ALTER TABLE `PhotoActivity`
  ADD CONSTRAINT `PhotoActivity_submittedById_fkey` FOREIGN KEY (`submittedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `PhotoActivity_approvedById_fkey` FOREIGN KEY (`approvedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `PhotoActivityWatermark`
  ADD CONSTRAINT `PhotoActivityWatermark_activityId_fkey` FOREIGN KEY (`activityId`) REFERENCES `PhotoActivity`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `Photo`
  ADD CONSTRAINT `Photo_activityId_fkey` FOREIGN KEY (`activityId`) REFERENCES `PhotoActivity`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
