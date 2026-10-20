-- 管理员（二级代理）默认邀请码额度：50 -> 20。
-- 1) 改默认值：之后新建的管理员账号直接按 20 起算。
-- 2) 回溯已有管理员：统一压到 20；已经用超的保持「已用」不倒退，
--    取 GREATEST(20, 已用)，避免出现剩余为负或额度不能再被超级管理员调整。
ALTER TABLE `User` MODIFY `staffInviteLimit` INTEGER NOT NULL DEFAULT 20;

UPDATE `User`
SET `staffInviteLimit` = GREATEST(20, `staffInviteUsed`)
WHERE `role` = 'ADMIN'
  AND `staffInviteLimit` <> GREATEST(20, `staffInviteUsed`);
