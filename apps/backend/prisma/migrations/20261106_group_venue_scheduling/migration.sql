ALTER TABLE `TournamentGroup` ADD COLUMN `restrictVenues` BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE `Tournament` ADD COLUMN `schedulingSettings` JSON NULL;
ALTER TABLE `Match`
  ADD COLUMN `scheduleLocked` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `scheduleOverride` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `unscheduledReason` VARCHAR(255) NULL;
CREATE TABLE `GroupVenue` (
  `groupId` VARCHAR(191) NOT NULL,
  `venueId` VARCHAR(191) NOT NULL,
  PRIMARY KEY (`groupId`, `venueId`),
  INDEX `GroupVenue_venueId_idx` (`venueId`),
  CONSTRAINT `GroupVenue_groupId_fkey` FOREIGN KEY (`groupId`) REFERENCES `TournamentGroup` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `GroupVenue_venueId_fkey` FOREIGN KEY (`venueId`) REFERENCES `Venue` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE `ScheduleOperationLog` (
  `id` VARCHAR(191) NOT NULL,
  `tournamentId` VARCHAR(191) NOT NULL,
  `actorId` VARCHAR(191) NULL,
  `action` VARCHAR(32) NOT NULL,
  `before` JSON NOT NULL,
  `after` JSON NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `ScheduleOperationLog_tournamentId_createdAt_idx` (`tournamentId`, `createdAt`),
  CONSTRAINT `ScheduleOperationLog_tournamentId_fkey` FOREIGN KEY (`tournamentId`) REFERENCES `Tournament` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
