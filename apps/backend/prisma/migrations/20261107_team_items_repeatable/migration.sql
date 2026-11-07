-- 团体赛出场项目允许重复（如三单两双：男单、男单、男双…），最多 7 项，按出场顺序区分。
-- 去掉「同一团体赛每个项目只能出现一次」的唯一约束；出场顺序的唯一约束保留。
-- 外键 teamCompetitionId 仍有 (teamCompetitionId, sortOrder) 唯一索引可用，删除本索引不影响外键。
DROP INDEX `TeamCompetitionItem_teamCompetitionId_eventType_key` ON `TeamCompetitionItem`;
