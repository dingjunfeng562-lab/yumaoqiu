CREATE TABLE `email_global_setting` (
  `id` VARCHAR(32) NOT NULL,
  `enabled` BOOLEAN NOT NULL DEFAULT true,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `email_templates` (
  `id` VARCHAR(191) NOT NULL,
  `key` VARCHAR(64) NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `subject` VARCHAR(255) NOT NULL,
  `body` TEXT NOT NULL,
  `enabled` BOOLEAN NOT NULL DEFAULT true,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `email_templates_key_key` (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `event_email_settings` (
  `id` VARCHAR(191) NOT NULL,
  `event_id` VARCHAR(191) NOT NULL,
  `template_key` VARCHAR(64) NOT NULL,
  `enabled` BOOLEAN NOT NULL DEFAULT false,
  `remind_before_minutes` INT NULL,
  `scheduled_send_time` DATETIME(3) NULL,
  `auto_sent` BOOLEAN NOT NULL DEFAULT false,
  `last_sent_at` DATETIME(3) NULL,
  `manual_send_count` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `event_email_settings_event_id_template_key_key` (`event_id`, `template_key`),
  INDEX `event_email_settings_template_key_enabled_auto_sent_schedul_idx` (`template_key`, `enabled`, `auto_sent`, `scheduled_send_time`),
  CONSTRAINT `event_email_settings_event_id_fkey` FOREIGN KEY (`event_id`) REFERENCES `tournament` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `email_logs` (
  `id` VARCHAR(191) NOT NULL,
  `event_id` VARCHAR(191) NULL,
  `template_key` VARCHAR(64) NOT NULL,
  `recipient` VARCHAR(191) NULL,
  `subject` VARCHAR(255) NULL,
  `status` ENUM('SENT', 'FAILED', 'SKIPPED') NOT NULL,
  `reason` VARCHAR(500) NULL,
  `trigger` VARCHAR(16) NOT NULL DEFAULT 'auto',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `email_logs_event_id_created_at_idx` (`event_id`, `created_at`),
  INDEX `email_logs_status_created_at_idx` (`status`, `created_at`),
  INDEX `email_logs_template_key_status_idx` (`template_key`, `status`),
  CONSTRAINT `email_logs_event_id_fkey` FOREIGN KEY (`event_id`) REFERENCES `tournament` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
