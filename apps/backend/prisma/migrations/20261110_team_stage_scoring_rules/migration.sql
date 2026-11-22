-- 团体赛「小组赛 + 淘汰赛」赛制下，小组赛、淘汰赛的子项计分规则可以分开设置。
-- 结构同 Event.stageScoringRules：{ "GROUP": {...}, "KNOCKOUT": {...} }。
-- 只加可空列：为空时全部子项沿用团体赛的默认计分规则，旧代码不受影响。
ALTER TABLE `TeamCompetition`
  ADD COLUMN `stageScoringRules` JSON NULL;
