-- 彻底删除默认社会组（TournamentGroup.legacyType = 'SOCIAL'，ID 为「赛事ID_SOCIAL」）。
-- !!! 不可恢复：执行前必须备份数据库。
-- 会连带删除默认社会组下的全部数据：单项、报名（含游客报名）、抽签、比赛与比分、
-- 团体赛（队伍、对阵、出场名单）、收费设置、场地分配。选手档案（Player）保留。
-- 字段模板为「第三方」的自定义组别不受影响（内部 entrantType 仍为 SOCIAL）。
-- 依赖 20261106_custom_registration_groups：该迁移已把单项、团体赛、收费设置、报名挂到组别 ID 上，
-- 应用代码与本迁移必须一同部署。

-- 1. 删除默认社会组；外键 ON DELETE CASCADE 带走其下所有数据。
DELETE FROM `TournamentGroup` WHERE `legacyType` = 'SOCIAL';

-- 2. 兜底：没有挂到组别上的旧社会组数据（正常情况下上一迁移已全部挂好，这里应为 0 行）。
DELETE FROM `CompetitionRegistration` WHERE `groupId` IS NULL AND `entrantType` = 'SOCIAL';
DELETE FROM `TeamCompetition` WHERE `groupId` IS NULL AND `entrantType` = 'SOCIAL';
DELETE FROM `Event` WHERE `groupId` IS NULL AND `entrantType` = 'SOCIAL';
DELETE FROM `TournamentPaymentSetting` WHERE `groupId` IS NULL AND `entrantType` = 'SOCIAL';

-- 3. 自定义组别的「社会」字段模板并入「第三方」（GENERAL），两者报名行为完全一致。
UPDATE `TournamentGroup` SET `fieldTemplate` = 'GENERAL' WHERE `fieldTemplate` = 'SOCIAL';

-- 4. 去掉赛事上的社会组兼容字段。
UPDATE `Tournament`
SET `registrationFieldRules` = JSON_REMOVE(`registrationFieldRules`, '$.SOCIAL')
WHERE `registrationFieldRules` IS NOT NULL AND JSON_CONTAINS_PATH(`registrationFieldRules`, 'one', '$.SOCIAL');

ALTER TABLE `Tournament`
  DROP COLUMN `allowSocialRegistration`,
  DROP COLUMN `socialRegistrationCode`,
  DROP COLUMN `socialRegistrationCodeEnabled`;
