-- Introduce a ROOT ("超级管理员") role above SUPER_ADMIN ("总管理员").
-- ROOT is the supreme account (baishuwan) with full access. SUPER_ADMIN is
-- downgraded to an operations manager: it loses email settings, invite codes,
-- user management, and is read-only on player/registration data.

ALTER TABLE `user`
  MODIFY COLUMN `role` ENUM('ROOT', 'SUPER_ADMIN', 'ADMIN', 'REFEREE', 'PLAYER', 'PHOTOGRAPHER') NOT NULL;

ALTER TABLE `invitecode`
  MODIFY COLUMN `role` ENUM('ROOT', 'SUPER_ADMIN', 'ADMIN', 'REFEREE', 'PLAYER', 'PHOTOGRAPHER') NOT NULL;

UPDATE `user` SET `role` = 'ROOT' WHERE `username` = 'baishuwan';
