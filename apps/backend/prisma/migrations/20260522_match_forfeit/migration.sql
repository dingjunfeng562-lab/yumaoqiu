-- Add forfeit support to matches
ALTER TABLE `match`
  ADD COLUMN `forfeitedSide` INT NULL,
  ADD COLUMN `forfeitReason` VARCHAR(191) NULL;

-- Add FORFEIT event type
ALTER TABLE `matchevent`
  MODIFY COLUMN `type` ENUM(
    'POINT',
    'UNDO',
    'TIMEOUT',
    'MEDICAL_TIMEOUT',
    'WARNING',
    'YELLOW_CARD',
    'SERVE_CHANGE',
    'FORFEIT'
  ) NOT NULL;
