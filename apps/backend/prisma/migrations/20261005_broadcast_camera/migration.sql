ALTER TABLE `broadcast_session`
  ADD COLUMN `cameraTokenHash` VARCHAR(64) NULL,
  ADD COLUMN `ingestUrlEnc` TEXT NULL,
  ADD COLUMN `cameraSettings` JSON NULL,
  ADD COLUMN `cameraState` JSON NULL,
  ADD COLUMN `cameraLastSeenAt` DATETIME(3) NULL,
  ADD UNIQUE INDEX `broadcast_session_cameraTokenHash_key` (`cameraTokenHash`);
