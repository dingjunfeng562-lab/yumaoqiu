CREATE TABLE IF NOT EXISTS `PublicCompetitionOrder` (
  `id` INT NOT NULL,
  `mode` VARCHAR(32) NOT NULL,
  `orderedIds` JSON NOT NULL,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
