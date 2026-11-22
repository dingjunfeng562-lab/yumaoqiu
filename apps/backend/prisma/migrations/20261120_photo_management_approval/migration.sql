CREATE TABLE IF NOT EXISTS `PhotoManagementRequest` (
  `id` VARCHAR(191) NOT NULL,
  `applicantId` VARCHAR(191) NULL,
  `applicantName` VARCHAR(64) NOT NULL,
  `targetType` ENUM('TOURNAMENT', 'ACTIVITY') NOT NULL,
  `targetId` VARCHAR(191) NOT NULL,
  `targetName` VARCHAR(255) NOT NULL,
  `purpose` VARCHAR(500) NOT NULL,
  `status` ENUM('PENDING', 'APPROVED', 'REJECTED', 'REVOKED') NOT NULL DEFAULT 'PENDING',
  `active` BOOLEAN NULL DEFAULT true,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `reviewedById` VARCHAR(191) NULL,
  `reviewedByName` VARCHAR(64) NULL,
  `reviewedAt` DATETIME(3) NULL,
  `reviewReason` VARCHAR(500) NULL,
  `revokedById` VARCHAR(191) NULL,
  `revokedByName` VARCHAR(64) NULL,
  `revokedAt` DATETIME(3) NULL,
  `revokeReason` VARCHAR(500) NULL,
  UNIQUE INDEX `PhotoManagementRequest_active_target_key` (`applicantId`, `targetType`, `targetId`, `active`),
  INDEX `PhotoManagementRequest_status_createdAt_idx` (`status`, `createdAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `PhotoManagementRequest_applicantId_fkey`
    FOREIGN KEY (`applicantId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 上线前已经有照片的项目保留管理权限。封面、二维码和已删除照片不计入。
INSERT INTO `PhotoManagementRequest` (
  `id`, `applicantId`, `applicantName`, `targetType`, `targetId`, `targetName`, `purpose`,
  `status`, `active`, `reviewedByName`, `reviewedAt`, `reviewReason`
)
SELECT CONCAT('legacy_', REPLACE(UUID(), '-', '')), owner.`id`, owner.`username`,
  target.`targetType`, target.`id`, target.`name`, '上线前已使用图片管理',
  'APPROVED', true, '系统迁移', CURRENT_TIMESTAMP(3), '已有未删除的照片，自动开通'
FROM (
  SELECT 'TOURNAMENT' AS `targetType`, tournament.`id`, tournament.`name`, tournament.`submittedById`
  FROM `Tournament` AS tournament
  WHERE EXISTS (
    SELECT 1 FROM `Photo` AS photo WHERE photo.`tournamentId` = tournament.`id` AND photo.`deletedAt` IS NULL
  )
  UNION ALL
  SELECT 'ACTIVITY', activity.`id`, activity.`title`, activity.`submittedById`
  FROM `PhotoActivity` AS activity
  WHERE EXISTS (
    SELECT 1 FROM `Photo` AS photo WHERE photo.`activityId` = activity.`id` AND photo.`deletedAt` IS NULL
  )
) AS target
JOIN `User` AS owner ON owner.`id` = target.`submittedById` AND owner.`role` = 'ADMIN'
WHERE NOT EXISTS (
  SELECT 1 FROM `PhotoManagementRequest` AS existing
  WHERE existing.`targetType` = target.`targetType` AND existing.`targetId` = target.`id`
    AND existing.`applicantId` = owner.`id`
);
