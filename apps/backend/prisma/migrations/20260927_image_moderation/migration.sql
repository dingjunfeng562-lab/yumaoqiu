CREATE TABLE IF NOT EXISTS `image_moderation_config` (
    `id` VARCHAR(191) NOT NULL DEFAULT 'default',
    `enabled` BOOLEAN NOT NULL DEFAULT false,
    `api_key` VARCHAR(512) NOT NULL DEFAULT '',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
