-- Store the doubles partner's own college/class instead of deriving it from
-- the primary registrant.
ALTER TABLE `competitionregistrationeventitem`
  ADD COLUMN `partnerClassName` VARCHAR(120) NULL;
