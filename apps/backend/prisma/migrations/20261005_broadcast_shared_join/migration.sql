CREATE TABLE `broadcast_join_invite` (
  `id` VARCHAR(191) NOT NULL,
  `broadcastId` VARCHAR(191) NOT NULL,
  `codeHash` VARCHAR(64) NOT NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `claims` INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `broadcast_join_invite_broadcastId_key` (`broadcastId`),
  UNIQUE INDEX `broadcast_join_invite_codeHash_key` (`codeHash`),
  CONSTRAINT `broadcast_join_invite_broadcastId_fkey` FOREIGN KEY (`broadcastId`) REFERENCES `broadcast_session` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
