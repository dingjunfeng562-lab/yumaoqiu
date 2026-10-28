-- 学校/社会分组报名、双报名码、学生字段配置、社会组团体赛。
--
-- 适用：尚未包含本次改动的数据库（生产/新环境）。
-- 本机开发库此前用 `prisma db push` 同步过，结构已存在，不要在本机重复执行。
-- 表名按 Prisma 模型名（PascalCase）；Linux 大小写敏感库请先确认实际表名大小写。
--
-- 执行前先做两项预检；若有结果，先合并/清理再加唯一索引：
--   SELECT `tournamentId`, `entrantType`, `type`, COUNT(*) AS c
--   FROM `Event` GROUP BY `tournamentId`, `entrantType`, `type` HAVING c > 1;
--
--   SELECT `tournamentId`, `entrantType`, COUNT(*) AS c
--   FROM `TeamCompetition` GROUP BY `tournamentId`, `entrantType` HAVING c > 1;

-- ============================================================
-- 1. 赛事：分组开关、双报名码、学生字段规则
-- ============================================================
ALTER TABLE `Tournament`
  ADD COLUMN `allowSchoolRegistration` BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN `allowSocialRegistration` BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN `registrationCodeEnabled` BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN `registrationFieldRules` JSON NULL,
  ADD COLUMN `schoolRegistrationCode` VARCHAR(16) NULL,
  ADD COLUMN `schoolRegistrationCodeEnabled` BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN `socialRegistrationCode` VARCHAR(16) NULL,
  ADD COLUMN `socialRegistrationCodeEnabled` BOOLEAN NOT NULL DEFAULT true;

CREATE UNIQUE INDEX `Tournament_schoolRegistrationCode_key`
  ON `Tournament`(`schoolRegistrationCode`);
CREATE UNIQUE INDEX `Tournament_socialRegistrationCode_key`
  ON `Tournament`(`socialRegistrationCode`);

-- ============================================================
-- 2. 单项：学生组/社会组各一条同类型 Event
-- ============================================================
ALTER TABLE `Event`
  ADD COLUMN `entrantType` ENUM('SCHOOL', 'SOCIAL') NOT NULL DEFAULT 'SCHOOL',
  ADD COLUMN `groupLabel` VARCHAR(24) NULL;

CREATE INDEX `Event_tournamentId_entrantType_idx`
  ON `Event`(`tournamentId`, `entrantType`);
CREATE UNIQUE INDEX `Event_tournamentId_entrantType_type_key`
  ON `Event`(`tournamentId`, `entrantType`, `type`);

-- ============================================================
-- 3. 报名记录：身份 + 学校细分字段 + 搭档细分字段
-- ============================================================
ALTER TABLE `Registration`
  ADD COLUMN `college` VARCHAR(120) NULL,
  ADD COLUMN `entrantType` ENUM('SCHOOL', 'SOCIAL') NOT NULL DEFAULT 'SCHOOL',
  ADD COLUMN `majorGrade` VARCHAR(120) NULL,
  ADD COLUMN `partnerCollege` VARCHAR(120) NULL,
  ADD COLUMN `partnerMajorGrade` VARCHAR(120) NULL;

-- ============================================================
-- 4. 报名单：身份、游客、学号可空、学校细分字段
-- ============================================================
ALTER TABLE `CompetitionRegistration`
  ADD COLUMN `college` VARCHAR(120) NULL,
  ADD COLUMN `entrantType` ENUM('SCHOOL', 'SOCIAL') NOT NULL DEFAULT 'SCHOOL',
  ADD COLUMN `guestEmail` VARCHAR(191) NULL,
  ADD COLUMN `guestToken` VARCHAR(64) NULL,
  ADD COLUMN `majorGrade` VARCHAR(120) NULL,
  MODIFY `userId` VARCHAR(191) NULL,
  MODIFY `studentId` VARCHAR(191) NULL;

CREATE UNIQUE INDEX `CompetitionRegistration_guestToken_key`
  ON `CompetitionRegistration`(`guestToken`);
CREATE INDEX `CompetitionRegistration_competitionId_entrantType_status_idx`
  ON `CompetitionRegistration`(`competitionId`, `entrantType`, `status`);

ALTER TABLE `CompetitionRegistrationEventItem`
  ADD COLUMN `partnerCollege` VARCHAR(120) NULL,
  ADD COLUMN `partnerMajorGrade` VARCHAR(120) NULL;

-- ============================================================
-- 5. 团体赛：一个赛事学生组/社会组各一条
-- ============================================================
ALTER TABLE `TeamCompetition`
  ADD COLUMN `entrantType` ENUM('SCHOOL', 'SOCIAL') NOT NULL DEFAULT 'SCHOOL';

CREATE UNIQUE INDEX `TeamCompetition_tournamentId_entrantType_key`
  ON `TeamCompetition`(`tournamentId`, `entrantType`);

-- ============================================================
-- 6. 历史身份回填
-- ============================================================
-- 旧社会人员报名（后台批量导入）没有学号，回填为 SOCIAL；其余保持 SCHOOL。
UPDATE `CompetitionRegistration`
  SET `entrantType` = 'SOCIAL'
  WHERE `studentId` IS NULL OR `studentId` = '';

UPDATE `Registration`
  SET `entrantType` = 'SOCIAL'
  WHERE `studentId` IS NULL OR `studentId` = '';

-- 旧 Event / TeamCompetition 全部为 SCHOOL，默认值已覆盖，无需额外 UPDATE。

-- ============================================================
-- 7. 报名码回填（必须执行）
-- ============================================================
-- 迁移本身只加列，不生成随机码。执行完本文件后运行：
--   cd apps/backend
--   pnpm exec ts-node prisma/backfill-registration-codes.ts
-- 脚本会为有学生组/社会组单项的赛事生成唯一报名码。
