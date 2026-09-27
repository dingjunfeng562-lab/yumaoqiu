-- Each tournament receives an opaque, administrator-generated URL for its
-- public photo gallery. A null token means no public gallery link exists yet.
ALTER TABLE `Tournament`
  ADD COLUMN `photoAccessToken` VARCHAR(64) NULL;

CREATE UNIQUE INDEX `tournament_photoAccessToken_key`
  ON `Tournament` (`photoAccessToken`);
