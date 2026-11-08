-- 单项级场地分配：男子单打等项目可单独指定场地，优先于所属组别。
-- venueRule 默认 INHERIT，存量赛事继续沿用「组别场地分配」，行为不变。
ALTER TABLE `Event` ADD COLUMN `venueRule` ENUM('INHERIT', 'ALL', 'SPECIFIED') NOT NULL DEFAULT 'INHERIT';

CREATE TABLE `EventVenue` (
  `eventId` VARCHAR(191) NOT NULL,
  `venueId` VARCHAR(191) NOT NULL,
  PRIMARY KEY (`eventId`, `venueId`),
  INDEX `EventVenue_venueId_idx` (`venueId`),
  CONSTRAINT `EventVenue_eventId_fkey` FOREIGN KEY (`eventId`) REFERENCES `Event` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `EventVenue_venueId_fkey` FOREIGN KEY (`venueId`) REFERENCES `Venue` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
