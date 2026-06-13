ALTER TABLE `event`
  MODIFY COLUMN `format` ENUM(
    'SINGLE_ELIMINATION',
    'GROUP_PLUS_KNOCKOUT',
    'ROUND_ROBIN',
    'GROUP_PLUS_PLAYOFF',
    'SINGLE_ELIMINATION_PLUS_GROUP_RANKING'
  ) NOT NULL;

CREATE TABLE `second_stage` (
  `id` VARCHAR(191) NOT NULL,
  `event_id` VARCHAR(191) NOT NULL,
  `status` ENUM('NOT_STARTED', 'DRAFT', 'CONFIRMED', 'FINISHED') NOT NULL DEFAULT 'NOT_STARTED',
  `mode` ENUM('MANUAL_BY_REFEREE') NOT NULL DEFAULT 'MANUAL_BY_REFEREE',
  `ranking_mode` ENUM('TOP_6', 'TOP_8') NOT NULL DEFAULT 'TOP_8',
  `confirmed_at` DATETIME(3) NULL,
  `finished_at` DATETIME(3) NULL,
  `created_by` VARCHAR(191) NULL,
  `updated_by` VARCHAR(191) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  UNIQUE INDEX `second_stage_event_id_key` (`event_id`),
  INDEX `second_stage_event_id_status_idx` (`event_id`, `status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `second_stage_slot` (
  `id` VARCHAR(191) NOT NULL,
  `second_stage_id` VARCHAR(191) NOT NULL,
  `slot` VARCHAR(1) NOT NULL,
  `sort_order` INTEGER NOT NULL,
  `entrant_id` VARCHAR(191) NULL,
  `entrant_name_snapshot` VARCHAR(128) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  UNIQUE INDEX `second_stage_slot_second_stage_id_slot_key` (`second_stage_id`, `slot`),
  INDEX `second_stage_slot_entrant_id_idx` (`entrant_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `second_stage_match` (
  `id` VARCHAR(191) NOT NULL,
  `second_stage_id` VARCHAR(191) NOT NULL,
  `match_no` INTEGER NOT NULL,
  `round_name` VARCHAR(32) NOT NULL,
  `area` VARCHAR(32) NOT NULL,
  `slot_info` VARCHAR(32) NULL,
  `side1_source` VARCHAR(32) NULL,
  `side2_source` VARCHAR(32) NULL,
  `side1_id` VARCHAR(191) NULL,
  `side2_id` VARCHAR(191) NULL,
  `side1_name_snapshot` VARCHAR(128) NULL,
  `side2_name_snapshot` VARCHAR(128) NULL,
  `score` VARCHAR(64) NULL,
  `status` ENUM('PENDING', 'LIVE', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
  `winner_side` INTEGER NULL,
  `winner_id` VARCHAR(191) NULL,
  `winner_name_snapshot` VARCHAR(128) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  UNIQUE INDEX `second_stage_match_second_stage_id_match_no_key` (`second_stage_id`, `match_no`),
  INDEX `second_stage_match_second_stage_id_status_idx` (`second_stage_id`, `status`),
  INDEX `second_stage_match_side1_id_idx` (`side1_id`),
  INDEX `second_stage_match_side2_id_idx` (`side2_id`),
  INDEX `second_stage_match_winner_id_idx` (`winner_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `second_stage_ranking` (
  `id` VARCHAR(191) NOT NULL,
  `second_stage_id` VARCHAR(191) NOT NULL,
  `rank` INTEGER NOT NULL,
  `entrant_id` VARCHAR(191) NULL,
  `entrant_name_snapshot` VARCHAR(128) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  UNIQUE INDEX `second_stage_ranking_second_stage_id_rank_key` (`second_stage_id`, `rank`),
  INDEX `second_stage_ranking_entrant_id_idx` (`entrant_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `second_stage`
  ADD CONSTRAINT `second_stage_event_id_fkey`
  FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `second_stage_slot`
  ADD CONSTRAINT `second_stage_slot_second_stage_id_fkey`
  FOREIGN KEY (`second_stage_id`) REFERENCES `second_stage`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `second_stage_match`
  ADD CONSTRAINT `second_stage_match_second_stage_id_fkey`
  FOREIGN KEY (`second_stage_id`) REFERENCES `second_stage`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `second_stage_ranking`
  ADD CONSTRAINT `second_stage_ranking_second_stage_id_fkey`
  FOREIGN KEY (`second_stage_id`) REFERENCES `second_stage`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
