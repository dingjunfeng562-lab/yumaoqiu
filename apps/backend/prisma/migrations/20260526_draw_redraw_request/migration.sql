CREATE TABLE `draw_redraw_request` (
  `id` VARCHAR(191) NOT NULL,
  `event_item_id` VARCHAR(191) NOT NULL,
  `draw_bracket_id` VARCHAR(191) NULL,
  `status` ENUM('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
  `reason` VARCHAR(500) NULL,
  `requester_id` VARCHAR(191) NOT NULL,
  `requester_name_snapshot` VARCHAR(64) NULL,
  `decided_by_id` VARCHAR(191) NULL,
  `decided_by_name_snapshot` VARCHAR(64) NULL,
  `decision_remark` VARCHAR(500) NULL,
  `decided_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  INDEX `draw_redraw_request_event_item_id_status_idx` (`event_item_id`, `status`),
  INDEX `draw_redraw_request_requester_id_idx` (`requester_id`),
  INDEX `draw_redraw_request_status_created_at_idx` (`status`, `created_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `draw_redraw_request`
  ADD CONSTRAINT `draw_redraw_request_event_item_id_fkey`
  FOREIGN KEY (`event_item_id`) REFERENCES `Event`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `draw_redraw_request`
  ADD CONSTRAINT `draw_redraw_request_requester_id_fkey`
  FOREIGN KEY (`requester_id`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `draw_redraw_request`
  ADD CONSTRAINT `draw_redraw_request_decided_by_id_fkey`
  FOREIGN KEY (`decided_by_id`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
