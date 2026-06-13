-- drawLocked 语义调整为「签表已冻结或对阵已发布」。
-- 解锁存量数据：未发布且当前签表未冻结的单项，此前被抽签操作误锁，重置为可编辑。
UPDATE `event` e
SET e.`drawLocked` = 0
WHERE e.`drawPublished` = 0
  AND NOT EXISTS (
    SELECT 1
    FROM `draw_bracket` b
    WHERE b.`event_item_id` = e.`id`
      AND b.`is_current` = 1
      AND b.`status` = 'FROZEN'
  );
