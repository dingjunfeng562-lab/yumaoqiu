-- Add independent watermark sizes for portrait photos.
ALTER TABLE `TournamentWatermark` ADD COLUMN `portraitLogoHeightPercent` INTEGER NULL;
ALTER TABLE `TournamentWatermark` ADD COLUMN `portraitLogoGapPercent` INTEGER NULL;
ALTER TABLE `TournamentWatermark` ADD COLUMN `portraitTextSizePercent` INTEGER NULL;

ALTER TABLE `PhotoActivityWatermark` ADD COLUMN `portraitLogoHeightPercent` INTEGER NULL;
ALTER TABLE `PhotoActivityWatermark` ADD COLUMN `portraitLogoGapPercent` INTEGER NULL;
ALTER TABLE `PhotoActivityWatermark` ADD COLUMN `portraitTextSizePercent` INTEGER NULL;
