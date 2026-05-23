-- Introduce SUPER_ADMIN role on top of ADMIN/REFEREE/PLAYER.
-- Promote baishuwan to SUPER_ADMIN so existing tournament approval / user
-- creation continues to flow through the same account.

ALTER TABLE `user`
  MODIFY COLUMN `role` ENUM('SUPER_ADMIN', 'ADMIN', 'REFEREE', 'PLAYER') NOT NULL;

ALTER TABLE `invitecode`
  MODIFY COLUMN `role` ENUM('SUPER_ADMIN', 'ADMIN', 'REFEREE', 'PLAYER') NOT NULL;

UPDATE `user` SET `role` = 'SUPER_ADMIN' WHERE `username` = 'baishuwan';
