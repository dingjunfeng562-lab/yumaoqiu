-- Give tournament.edition a default so it can be omitted at create time
ALTER TABLE `tournament`
  MODIFY COLUMN `edition` INT NOT NULL DEFAULT 1;
