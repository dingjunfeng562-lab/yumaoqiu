-- 团体淘汰赛第三名的决出方式：按成绩排定（旧数据默认）/ 并列第三 / 加赛季军赛
ALTER TABLE `TeamCompetition`
  ADD COLUMN `thirdPlaceMode` ENUM('BY_RECORD', 'SHARED', 'PLAYOFF') NOT NULL DEFAULT 'BY_RECORD';
