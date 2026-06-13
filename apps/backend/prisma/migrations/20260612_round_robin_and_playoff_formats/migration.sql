-- 新增两种赛制：
--   ROUND_ROBIN        单循环排名赛（所有选手一个组，直接排出全部名次）
--   GROUP_PLUS_PLAYOFF 小组循环 + 交叉排位赛（两组循环后交叉决出每个名次）
-- 同步扩展抽签快照表 draw_bracket 的 format 枚举。

ALTER TABLE `event`
  MODIFY COLUMN `format` ENUM(
    'SINGLE_ELIMINATION',
    'GROUP_PLUS_KNOCKOUT',
    'ROUND_ROBIN',
    'GROUP_PLUS_PLAYOFF'
  ) NOT NULL;

ALTER TABLE `draw_bracket`
  MODIFY COLUMN `format` ENUM(
    'single_elim',
    'group_then_elim',
    'round_robin',
    'group_then_playoff'
  ) NOT NULL;
