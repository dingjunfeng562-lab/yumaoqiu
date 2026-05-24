ALTER TABLE `Announcement`
  ADD COLUMN `displayMode` VARCHAR(24) NOT NULL DEFAULT 'popup',
  ADD COLUMN `scope` VARCHAR(24) NOT NULL DEFAULT 'global',
  ADD COLUMN `frequency` VARCHAR(24) NOT NULL DEFAULT 'every_visit',
  ADD COLUMN `status` VARCHAR(24) NOT NULL DEFAULT 'draft',
  ADD COLUMN `startAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  ADD COLUMN `endAt` DATETIME(3) NULL,
  ADD COLUMN `closable` BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN `primaryButtonText` VARCHAR(40) NULL,
  ADD COLUMN `primaryButtonLink` VARCHAR(255) NULL,
  ADD COLUMN `secondaryButtonText` VARCHAR(40) NULL,
  ADD COLUMN `priority` INTEGER NOT NULL DEFAULT 0;

UPDATE `Announcement`
SET
  `displayMode` = CASE WHEN `showAsPopup` = true THEN 'popup' ELSE 'banner' END,
  `scope` = 'global',
  `frequency` = 'every_visit',
  `status` = CASE WHEN `isPublished` = true THEN 'published' ELSE 'draft' END,
  `startAt` = COALESCE(`publishedAt`, `createdAt`),
  `endAt` = `expiresAt`,
  `priority` = `sortOrder`;

CREATE INDEX `Announcement_status_displayMode_scope_startAt_idx`
  ON `Announcement`(`status`, `displayMode`, `scope`, `startAt`);

CREATE INDEX `Announcement_priority_idx`
  ON `Announcement`(`priority`);
