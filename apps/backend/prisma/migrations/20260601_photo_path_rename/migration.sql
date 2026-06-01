-- 图片存储字段重命名,与新命名约定对齐(语义不变):
--   watermarkPath → fullPath        高清水印版(保留原分辨率,JPEG 95,用户下载/全屏预览)
--   thumbPath     → thumbnailPath   缩略图(500px 宽,JPEG 80,相册网格)
-- originalPath(无水印原图)保留不动:仍供管理员「查看原图」+ 审计日志使用。
-- 用 CHANGE COLUMN 而非 RENAME COLUMN,兼容 MySQL 5.7 / MariaDB 10.4 等旧版本。
ALTER TABLE `photo` CHANGE COLUMN `watermarkPath` `fullPath` VARCHAR(500) NOT NULL;
ALTER TABLE `photo` CHANGE COLUMN `thumbPath` `thumbnailPath` VARCHAR(500) NOT NULL;
