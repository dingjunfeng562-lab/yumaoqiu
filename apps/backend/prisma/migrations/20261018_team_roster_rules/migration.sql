-- Existing competitions keep their rosters until an administrator sets the new rules.
ALTER TABLE `TeamCompetition`
  ADD COLUMN `malePlayerCount` INTEGER NULL,
  ADD COLUMN `femalePlayerCount` INTEGER NULL,
  ADD COLUMN `scoringRule` ENUM('FIFTEEN_ONE', 'FIFTEEN_BO3', 'TWENTYONE_BO3', 'THIRTYONE_BO3') NOT NULL DEFAULT 'TWENTYONE_BO3',
  ADD COLUMN `scoringMode` ENUM('CAPPED_30', 'STANDARD_GOLDEN') NOT NULL DEFAULT 'CAPPED_30',
  ADD COLUMN `customGamePoint` INTEGER NULL,
  ADD COLUMN `customGameCap` INTEGER NULL,
  ADD COLUMN `customGamesToWin` INTEGER NULL;

ALTER TABLE `Match` ADD COLUMN `lineupLocked` BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE `Team` ADD COLUMN `rosterOverrideConfirmed` BOOLEAN NOT NULL DEFAULT false;
UPDATE `Match` m INNER JOIN `TeamMatch` t ON m.`teamMatchId` = t.`id`
SET m.`lineupLocked` = true WHERE t.`lineupLocked` = true OR m.`status` <> 'PENDING';

-- A lineup belongs to one encounter; the same team may field different players next round.
UPDATE `Match`
SET `side1Id` = CONCAT('lineup:', `teamMatchId`, ':', SUBSTRING(`side1Id`, 8))
WHERE `teamMatchId` IS NOT NULL AND `side1Id` LIKE 'lineup:%'
  AND LENGTH(`side1Id`) - LENGTH(REPLACE(`side1Id`, ':', '')) = 2;
UPDATE `Match`
SET `side2Id` = CONCAT('lineup:', `teamMatchId`, ':', SUBSTRING(`side2Id`, 8))
WHERE `teamMatchId` IS NOT NULL AND `side2Id` LIKE 'lineup:%'
  AND LENGTH(`side2Id`) - LENGTH(REPLACE(`side2Id`, ':', '')) = 2;
