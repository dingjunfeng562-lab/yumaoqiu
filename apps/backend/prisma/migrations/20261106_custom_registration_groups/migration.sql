-- 自定义赛事组别。执行前备份；应用与迁移必须一同部署。
-- 保留所有旧 ID、报名码、参赛记录及收费数据。
CREATE TABLE `TournamentGroup` (
  `id` VARCHAR(191) NOT NULL,
  `tournamentId` VARCHAR(191) NOT NULL,
  `name` VARCHAR(60) NOT NULL,
  `categoryLabel` VARCHAR(60) NULL,
  `legacyType` ENUM('SCHOOL','SOCIAL') NULL,
  `fieldTemplate` VARCHAR(16) NOT NULL DEFAULT 'GENERAL',
  `enabled` BOOLEAN NOT NULL DEFAULT true,
  `registrationCode` VARCHAR(16) NULL,
  `registrationCodeEnabled` BOOLEAN NOT NULL DEFAULT true,
  `fieldRules` JSON NULL,
  `ageRule` JSON NULL,
  `ruleVersion` INTEGER NOT NULL DEFAULT 1,
  `sortOrder` INTEGER NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `TournamentGroup_registrationCode_key` (`registrationCode`),
  UNIQUE INDEX `TournamentGroup_tournamentId_name_key` (`tournamentId`,`name`),
  UNIQUE INDEX `TournamentGroup_tournamentId_legacyType_key` (`tournamentId`,`legacyType`),
  CONSTRAINT `TournamentGroup_tournamentId_fkey` FOREIGN KEY (`tournamentId`) REFERENCES `Tournament` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `Event` ADD COLUMN `groupId` VARCHAR(191) NULL, MODIFY `groupLabel` VARCHAR(60) NULL;
ALTER TABLE `TeamCompetition` ADD COLUMN `groupId` VARCHAR(191) NULL;
ALTER TABLE `TournamentPaymentSetting` ADD COLUMN `groupId` VARCHAR(191) NULL;
ALTER TABLE `Player` MODIFY `gender` ENUM('MALE','FEMALE') NULL;
ALTER TABLE `CompetitionRegistration`
  ADD COLUMN `groupId` VARCHAR(191) NULL,
  ADD COLUMN `personKey` VARCHAR(64) NULL,
  ADD COLUMN `identityData` JSON NULL,
  ADD COLUMN `eligibility` JSON NULL,
  MODIFY `gender` ENUM('MALE','FEMALE') NULL;
ALTER TABLE `Registration` ADD COLUMN `identityData` JSON NULL, ADD COLUMN `partnerIdentityData` JSON NULL, ADD COLUMN `eligibility` JSON NULL;
ALTER TABLE `CompetitionRegistrationEventItem` ADD COLUMN `identityData` JSON NULL, ADD COLUMN `partnerIdentityData` JSON NULL, ADD COLUMN `eligibility` JSON NULL;
ALTER TABLE `TeamMember` ADD COLUMN `identityData` JSON NULL, ADD COLUMN `eligibility` JSON NULL;

INSERT INTO `TournamentGroup` (`id`,`tournamentId`,`name`,`legacyType`,`fieldTemplate`,`enabled`,`registrationCode`,`registrationCodeEnabled`,`fieldRules`,`ageRule`,`sortOrder`,`updatedAt`)
SELECT CONCAT(`id`,'_SCHOOL'),`id`,'学生组','SCHOOL','SCHOOL',`allowSchoolRegistration`,`schoolRegistrationCode`,`schoolRegistrationCodeEnabled`,
JSON_OBJECT('identityNumber','hidden','gender','required',
 'studentId',COALESCE(JSON_UNQUOTE(JSON_EXTRACT(`registrationFieldRules`,'$.SCHOOL.studentId')),'required'),
 'college',COALESCE(JSON_UNQUOTE(JSON_EXTRACT(`registrationFieldRules`,'$.SCHOOL.college')),'required'),
 'majorGrade',COALESCE(JSON_UNQUOTE(JSON_EXTRACT(`registrationFieldRules`,'$.SCHOOL.majorGrade')),'optional'),
 'email','optional'),JSON_OBJECT('mode','NONE'),0,CURRENT_TIMESTAMP(3) FROM `Tournament`;
INSERT INTO `TournamentGroup` (`id`,`tournamentId`,`name`,`legacyType`,`fieldTemplate`,`enabled`,`registrationCode`,`registrationCodeEnabled`,`fieldRules`,`ageRule`,`sortOrder`,`updatedAt`)
SELECT CONCAT(`id`,'_SOCIAL'),`id`,'社会组','SOCIAL','SOCIAL',`allowSocialRegistration`,`socialRegistrationCode`,`socialRegistrationCodeEnabled`,
JSON_OBJECT('identityNumber','hidden','gender','required','studentId','hidden','college','hidden','majorGrade','hidden',
 'email',COALESCE(JSON_UNQUOTE(JSON_EXTRACT(`registrationFieldRules`,'$.SOCIAL.email')),'optional')),JSON_OBJECT('mode','NONE'),1,CURRENT_TIMESTAMP(3) FROM `Tournament`;

UPDATE `Event` SET `groupId`=CONCAT(`tournamentId`,'_',`entrantType`);
UPDATE `TeamCompetition` SET `groupId`=CONCAT(`tournamentId`,'_',`entrantType`);
UPDATE `TournamentPaymentSetting` SET `groupId`=CONCAT(`tournamentId`,'_',`entrantType`);
UPDATE `CompetitionRegistration` SET `groupId`=CONCAT(`competitionId`,'_',`entrantType`);
-- 历史 personKey 留空，旧的重复数据不在迁移时合并；服务端先查历史记录再绑定身份键。

-- 先加新索引，再去除旧索引，避免破坏外键依赖的前缀索引。
CREATE UNIQUE INDEX `Event_tournamentId_groupId_type_key` ON `Event` (`tournamentId`,`groupId`,`type`);
CREATE UNIQUE INDEX `TeamCompetition_tournamentId_groupId_key` ON `TeamCompetition` (`tournamentId`,`groupId`);
CREATE UNIQUE INDEX `TournamentPaymentSetting_tournamentId_groupId_key` ON `TournamentPaymentSetting` (`tournamentId`,`groupId`);
CREATE INDEX `CompetitionRegistration_competitionId_userId_idx` ON `CompetitionRegistration` (`competitionId`,`userId`);
CREATE UNIQUE INDEX `CompetitionRegistration_competitionId_personKey_key` ON `CompetitionRegistration` (`competitionId`,`personKey`);
DROP INDEX `Event_tournamentId_entrantType_type_key` ON `Event`;
DROP INDEX `TeamCompetition_tournamentId_entrantType_key` ON `TeamCompetition`;
DROP INDEX `TournamentPaymentSetting_tournamentId_entrantType_key` ON `TournamentPaymentSetting`;
DROP INDEX `CompetitionRegistration_competitionId_userId_key` ON `CompetitionRegistration`;

ALTER TABLE `Event` ADD CONSTRAINT `Event_groupId_fkey` FOREIGN KEY (`groupId`) REFERENCES `TournamentGroup` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `TeamCompetition` ADD CONSTRAINT `TeamCompetition_groupId_fkey` FOREIGN KEY (`groupId`) REFERENCES `TournamentGroup` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `TournamentPaymentSetting` ADD CONSTRAINT `TournamentPaymentSetting_groupId_fkey` FOREIGN KEY (`groupId`) REFERENCES `TournamentGroup` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `CompetitionRegistration` ADD CONSTRAINT `CompetitionRegistration_groupId_fkey` FOREIGN KEY (`groupId`) REFERENCES `TournamentGroup` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
