ALTER TABLE `broadcast_session`
  ADD COLUMN `liveRoomName` VARCHAR(120) NULL,
  ADD COLUMN `liveSequence` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `activeCameraId` VARCHAR(191) NULL,
  ADD COLUMN `previewCameraId` VARCHAR(191) NULL,
  ADD COLUMN `audioCameraId` VARCHAR(191) NULL,
  ADD COLUMN `previousCameraId` VARCHAR(191) NULL,
  ADD COLUMN `transitionUntil` DATETIME(3) NULL,
  ADD UNIQUE INDEX `broadcast_session_liveRoomName_key` (`liveRoomName`);

CREATE TABLE `broadcast_camera` (
  `id` VARCHAR(191) NOT NULL, `broadcastId` VARCHAR(191) NOT NULL,
  `code` VARCHAR(12) NOT NULL, `name` VARCHAR(60) NOT NULL,
  `pairingHash` VARCHAR(64) NULL, `pairingExpiresAt` DATETIME(3) NULL,
  `tokenHash` VARCHAR(64) NULL, `deviceId` VARCHAR(120) NULL,
  `state` JSON NULL, `lastSeenAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`), UNIQUE INDEX `broadcast_camera_pairingHash_key` (`pairingHash`),
  UNIQUE INDEX `broadcast_camera_tokenHash_key` (`tokenHash`),
  UNIQUE INDEX `broadcast_camera_broadcastId_code_key` (`broadcastId`, `code`),
  CONSTRAINT `broadcast_camera_broadcastId_fkey` FOREIGN KEY (`broadcastId`) REFERENCES `broadcast_session` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `broadcast_director` (
  `id` VARCHAR(191) NOT NULL, `broadcastId` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL, `canAudio` BOOLEAN NOT NULL DEFAULT false,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`), UNIQUE INDEX `broadcast_director_broadcastId_userId_key` (`broadcastId`, `userId`),
  CONSTRAINT `broadcast_director_broadcastId_fkey` FOREIGN KEY (`broadcastId`) REFERENCES `broadcast_session` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `broadcast_live_log` (
  `id` VARCHAR(191) NOT NULL, `broadcastId` VARCHAR(191) NOT NULL,
  `kind` VARCHAR(30) NOT NULL, `fromId` VARCHAR(191) NULL, `toId` VARCHAR(191) NULL,
  `operatorId` VARCHAR(191) NULL, `sequence` INTEGER NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`), INDEX `broadcast_live_log_broadcastId_createdAt_idx` (`broadcastId`, `createdAt`),
  CONSTRAINT `broadcast_live_log_broadcastId_fkey` FOREIGN KEY (`broadcastId`) REFERENCES `broadcast_session` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
