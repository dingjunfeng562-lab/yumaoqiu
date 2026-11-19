-- 抽签小组编号：每个单项可选 A、B、C（默认）或 1、2、3。
-- 只加一列，默认 LETTER：已有单项、签表、赛程、比分都不变。
ALTER TABLE `Event`
  ADD COLUMN `groupNaming` ENUM('LETTER', 'NUMBER') NOT NULL DEFAULT 'LETTER';

-- 抽签操作日志多一种操作：切换小组编号方式（已有小组直接改名）。只在末尾追加枚举值，已有日志不变。
ALTER TABLE `draw_operation_log`
  MODIFY `operation_type` ENUM('SEED_UPDATE', 'EXECUTE', 'SWAP', 'FREEZE', 'REDRAW', 'GROUP_NAMING') NOT NULL;
