-- 场地排程：组别可以指定在哪几天比赛（playDates，["2026-11-15", ...]，为空表示不限）。
-- 手动调整时改到组别日期以外要勾选确认，比赛上记 dateOverride（临时改期）。
-- 只加可空列和带默认值的列：旧数据不限日期，已排的赛程不受影响。
ALTER TABLE `TournamentGroup`
  ADD COLUMN `playDates` JSON NULL;

ALTER TABLE `Match`
  ADD COLUMN `dateOverride` BOOLEAN NOT NULL DEFAULT false;
