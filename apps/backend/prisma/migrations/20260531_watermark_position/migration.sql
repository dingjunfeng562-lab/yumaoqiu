-- 赛事图片功能:水印位置可调,支持四角(默认右上角)。
-- 取值:TOP_LEFT / TOP_RIGHT / BOTTOM_LEFT / BOTTOM_RIGHT。
ALTER TABLE `tournamentwatermark`
  ADD COLUMN `position` VARCHAR(16) NOT NULL DEFAULT 'TOP_RIGHT';
