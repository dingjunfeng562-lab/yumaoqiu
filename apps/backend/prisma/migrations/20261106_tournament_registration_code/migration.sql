-- 一个赛事一个报名码：扫码后报名人自己选组别，各组别不再单独发码。
-- 沿用已发出的码：优先取学生组报名码，没有时取排在最前的组别报名码，
-- 这些码生成时已全局查重，搬到赛事上不会撞码。仍没有码的赛事在后台「报名码」列点「生成」。
-- 旧的组别码、学生组码列保留，扫旧码仍能进入报名并预选对应组别。
ALTER TABLE `Tournament` ADD COLUMN `registrationCode` VARCHAR(16) NULL;

UPDATE `Tournament` t
SET t.`registrationCode` = COALESCE(
  t.`schoolRegistrationCode`,
  (SELECT g.`registrationCode` FROM `TournamentGroup` g
   WHERE g.`tournamentId` = t.`id` AND g.`registrationCode` IS NOT NULL
   ORDER BY g.`sortOrder`, g.`createdAt` LIMIT 1)
);

CREATE UNIQUE INDEX `Tournament_registrationCode_key` ON `Tournament`(`registrationCode`);
