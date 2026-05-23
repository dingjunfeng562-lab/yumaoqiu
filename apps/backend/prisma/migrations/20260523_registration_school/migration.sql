-- Add full school name to competition registrations so we can show it on the
-- registration form, in admin review and on the approved players list.
ALTER TABLE `competitionregistration`
  ADD COLUMN `school` VARCHAR(191) NULL;
