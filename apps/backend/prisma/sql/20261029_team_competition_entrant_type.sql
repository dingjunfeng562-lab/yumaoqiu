-- 社会组团体赛增量迁移（仅 TeamCompetition 部分）。
--
-- 适用场景：数据库已经执行过 `20261029_school_social_groups` 的其余部分，
-- 只差 `TeamCompetition.entrantType`；或者单独补社会组团体赛。
-- 完整迁移见 `prisma/migrations/20261029_school_social_groups/migration.sql`。
--
-- 执行前检查一个赛事是否已有多个团体赛；有结果时先合并/清理，否则唯一索引会失败：
--   SELECT `tournamentId`, `entrantType`, COUNT(*) AS c
--   FROM `TeamCompetition`
--   GROUP BY `tournamentId`, `entrantType`
--   HAVING c > 1;

ALTER TABLE `TeamCompetition`
  ADD COLUMN `entrantType` ENUM('SCHOOL', 'SOCIAL') NOT NULL DEFAULT 'SCHOOL';

CREATE UNIQUE INDEX `TeamCompetition_tournamentId_entrantType_key`
  ON `TeamCompetition`(`tournamentId`, `entrantType`);

-- 旧团体赛全部按学生组处理（默认值已是 SCHOOL）。
-- 之后在「团体赛管理」新建社会组团体赛时，服务端会写入 entrantType = 'SOCIAL'。
