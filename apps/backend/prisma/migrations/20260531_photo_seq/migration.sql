-- 赛事图片功能:为每张照片增加「上传顺序」序号(按届赛事内的上传时间排序)。
-- 下载文件名使用「赛事名称-上传顺序」,不再依赖届次。
ALTER TABLE `photo` ADD COLUMN `seq` INT NOT NULL DEFAULT 0;

-- 回填已有照片:在每届赛事内按上传时间(再按 id)从 1 开始编号。
-- 用 CTE 而非 self-join,避开 MySQL/MariaDB 对在 UPDATE 中引用同表派生表的限制。
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY tournamentId ORDER BY uploadedAt, id) AS rn
  FROM `photo`
)
UPDATE `photo` p
JOIN ranked r ON r.id = p.id
SET p.seq = r.rn;
