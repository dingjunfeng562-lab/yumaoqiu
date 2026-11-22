ALTER TABLE `Match`
  ADD COLUMN `refereeClaimExpiresAt` DATETIME(3) NULL,
  ADD INDEX `Match_refereeClaimExpiresAt_idx` (`refereeClaimExpiresAt`);
