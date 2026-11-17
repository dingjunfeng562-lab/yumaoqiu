-- 赛事的「项目」文字由后台按「组别·项目」自动拼成（如「高中男子组·男子单打 / 高中男子组·男子双打 / …」），
-- 组别、项目一多就超过 VARCHAR(191)，新建/编辑赛事报 500（Data too long for column 'projectText'）。
-- 改成 TEXT，与 description / rules 一致；只放宽长度，已有数据不变。
-- 线上已于 2026-11-17 11:29 CST 手工执行（备份 /data/db-backups/pre-projecttext-20261117T032945Z-Tournament.sql.gz），下次部署不要重复执行。
ALTER TABLE `Tournament` MODIFY `projectText` TEXT NULL;
