-- New competition format: 小组循环+淘汰(标准) per 羽毛球竞赛规则2023.
-- Snake grouping + group round-robin (official ranking) -> top-N per group seeded
-- into a single-elimination knockout. Added alongside existing formats; nothing
-- else changes.

ALTER TABLE `event`
  MODIFY COLUMN `format` ENUM(
    'SINGLE_ELIMINATION',
    'GROUP_PLUS_KNOCKOUT',
    'GROUP_PLUS_KNOCKOUT_STD',
    'ROUND_ROBIN',
    'GROUP_PLUS_PLAYOFF',
    'SINGLE_ELIMINATION_PLUS_GROUP_RANKING'
  ) NOT NULL;
