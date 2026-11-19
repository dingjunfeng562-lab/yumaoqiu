-- 裁判员对局管理下放给管理员（只能管自己的赛事），并记录每一次修改。

-- 1. 操作记录：谁、什么时候、改了哪一场、改前改后。场次被删除（重新抽签等）时一起删除。
CREATE TABLE `MatchOperationLog` (
  `id` VARCHAR(191) NOT NULL,
  `matchId` VARCHAR(191) NOT NULL,
  `tournamentId` VARCHAR(191) NOT NULL,
  `action` VARCHAR(32) NOT NULL,
  `operatorId` VARCHAR(191) NULL,
  `operatorName` VARCHAR(64) NULL,
  `beforeData` JSON NULL,
  `afterData` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `MatchOperationLog_matchId_createdAt_idx` (`matchId`, `createdAt`),
  INDEX `MatchOperationLog_tournamentId_createdAt_idx` (`tournamentId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `MatchOperationLog` ADD CONSTRAINT `MatchOperationLog_matchId_fkey`
  FOREIGN KEY (`matchId`) REFERENCES `Match`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- 2. 新功能权限「对局管理」（MATCH_MANAGEMENT）：没单独设置过权限的管理员按默认就有；
--    单独设置过的，只给已有「裁判分配与比赛记分管理」（SCORING）的补上，被收回记分权限的不自动加。
UPDATE `User`
SET `permissions` = JSON_ARRAY_APPEND(`permissions`, '$', 'MATCH_MANAGEMENT')
WHERE `role` = 'ADMIN'
  AND JSON_TYPE(`permissions`) = 'ARRAY'
  AND JSON_CONTAINS(`permissions`, '"SCORING"')
  AND NOT JSON_CONTAINS(`permissions`, '"MATCH_MANAGEMENT"');
