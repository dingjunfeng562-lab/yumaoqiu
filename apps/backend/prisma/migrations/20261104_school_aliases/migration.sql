-- 赛事统计：学校名称归并表（全局）。只新建表，不改已有数据。
CREATE TABLE `school_aliases` (
    `id` VARCHAR(191) NOT NULL,
    `alias` VARCHAR(191) NOT NULL,
    `canonical` VARCHAR(191) NULL,
    `ignored` BOOLEAN NOT NULL DEFAULT false,
    `updated_by` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `school_aliases_alias_key`(`alias`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
