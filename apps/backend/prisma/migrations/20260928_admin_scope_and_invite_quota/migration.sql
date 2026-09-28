ALTER TABLE `User`
  ADD COLUMN `managerId` VARCHAR(191) NULL,
  ADD COLUMN `staffInviteLimit` INTEGER NOT NULL DEFAULT 50,
  ADD COLUMN `staffInviteUsed` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `staffQuotaCharged` BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE `InviteCode` ADD COLUMN `createdById` VARCHAR(191) NULL;
ALTER TABLE `Player` ADD COLUMN `ownerId` VARCHAR(191) NULL;
CREATE INDEX `User_managerId_idx` ON `User` (`managerId`);
CREATE INDEX `InviteCode_createdById_idx` ON `InviteCode` (`createdById`);
CREATE INDEX `Player_ownerId_idx` ON `Player` (`ownerId`);
CREATE INDEX `Tournament_submittedById_idx` ON `Tournament` (`submittedById`);
ALTER TABLE `User` ADD CONSTRAINT `User_managerId_fkey` FOREIGN KEY (`managerId`) REFERENCES `User` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `InviteCode` ADD CONSTRAINT `InviteCode_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `Player` ADD CONSTRAINT `Player_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;
