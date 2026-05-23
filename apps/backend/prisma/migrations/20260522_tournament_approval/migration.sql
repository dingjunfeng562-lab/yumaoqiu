-- Tournament approval workflow: new tournaments must be reviewed by the super-admin
-- before they become visible to the public.
ALTER TABLE `tournament`
  ADD COLUMN `approvalStatus` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
  ADD COLUMN `submittedById` VARCHAR(191) NULL,
  ADD COLUMN `approvedById` VARCHAR(191) NULL,
  ADD COLUMN `approvedAt` DATETIME(3) NULL,
  ADD COLUMN `rejectReason` VARCHAR(500) NULL;

CREATE INDEX `tournament_approvalStatus_isPublished_idx`
  ON `tournament` (`approvalStatus`, `isPublished`);

-- Existing data: tournaments that were already in the system pre-dating this
-- feature get auto-approved so the public site doesn't silently empty itself.
UPDATE `tournament` SET `approvalStatus` = 'APPROVED', `approvedAt` = NOW(3);
