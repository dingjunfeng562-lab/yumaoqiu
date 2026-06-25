-- Allow every user to rename themselves up to 3 times per rolling year.
-- `nameChangeCount` counts renames inside the current window; the window is
-- anchored at `nameChangeWindowStart` and lasts 365 days. Super-admin renames
-- do not touch these columns (they never consume a user's quota).

ALTER TABLE `user`
  ADD COLUMN `nameChangeCount` INT NOT NULL DEFAULT 0,
  ADD COLUMN `nameChangeWindowStart` DATETIME(3) NULL;
