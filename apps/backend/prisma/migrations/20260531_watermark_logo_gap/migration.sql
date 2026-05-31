-- 赛事图片功能:移除多 Logo 之间的「×」分隔符,改为可自由调整的 Logo 间距。
-- 间距以 Logo 高度的百分比表示(默认 20%)。
ALTER TABLE `tournamentwatermark`
  ADD COLUMN `logoGapPercent` INT NOT NULL DEFAULT 20;
