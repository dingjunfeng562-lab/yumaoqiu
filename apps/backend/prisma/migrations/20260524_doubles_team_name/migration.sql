-- Add team name for doubles registrations so the bracket can show the team name
-- as primary, with member names rendered as small subtext.
ALTER TABLE `competitionregistrationeventitem`
  ADD COLUMN `teamName` VARCHAR(120) NULL;

ALTER TABLE `registration`
  ADD COLUMN `teamName` VARCHAR(120) NULL;
