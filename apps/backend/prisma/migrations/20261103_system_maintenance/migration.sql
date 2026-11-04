-- 全服维护开关（单行配置）。表为空时按"未开启"处理，第一次保存时写入 default 行。
CREATE TABLE `system_maintenance` (
    `id` VARCHAR(32) NOT NULL DEFAULT 'default',
    `enabled` BOOLEAN NOT NULL DEFAULT false,
    `title` VARCHAR(80) NOT NULL DEFAULT '系统维护中',
    `content` MEDIUMTEXT NOT NULL,
    `started_at` DATETIME(3) NULL,
    `expected_end_at` DATETIME(3) NULL,
    `updated_by` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
