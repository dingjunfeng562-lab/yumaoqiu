-- 赛事图片功能:水印 Logo 大小可自定义。
-- 为每届赛事的水印配置增加 Logo 高度占图片高度的百分比(默认 8%)。
ALTER TABLE `tournamentwatermark`
  ADD COLUMN `logoHeightPercent` INT NOT NULL DEFAULT 8;
