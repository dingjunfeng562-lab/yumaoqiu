ALTER TABLE `tournamentwatermark`
  ADD COLUMN `text` VARCHAR(100) NULL,
  ADD COLUMN `textColor` VARCHAR(16) NULL,
  ADD COLUMN `textSizePercent` INT NULL,
  ADD COLUMN `textPosition` VARCHAR(16) NULL,
  ADD COLUMN `textPortraitPosition` VARCHAR(16) NULL;
