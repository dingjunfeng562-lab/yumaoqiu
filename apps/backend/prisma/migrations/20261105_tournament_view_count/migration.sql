-- 前台赛事主页浏览量（赛事列表封面右下角「小眼睛」）
ALTER TABLE `Tournament` ADD COLUMN `viewCount` INTEGER NOT NULL DEFAULT 0;
