-- 报名名额：项目名额（单打按人、双打按队）和组别总人数上限。
-- 只加可空列：为空表示不限，已有赛事和旧代码不受影响。
ALTER TABLE `Event`
  ADD COLUMN `maxEntries` INTEGER NULL;

ALTER TABLE `TournamentGroup`
  ADD COLUMN `maxEntrants` INTEGER NULL;
