ALTER TABLE `player`
  ADD COLUMN `isTemporary` BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE `registration`
  ADD COLUMN `partnerStudentId` VARCHAR(191) NULL,
  ADD COLUMN `partnerSchool` VARCHAR(191) NULL,
  ADD COLUMN `partnerClassName` VARCHAR(120) NULL,
  ADD COLUMN `partnerPhone` VARCHAR(191) NULL;
