-- Roster recognition (Excel/photo/PDF -> team roster) reuses the image moderation
-- DeepSeek channel but has its own switch and prompt, editable by ROOT only.
ALTER TABLE `ai_config`
  ADD COLUMN `roster_enabled` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `roster_prompt` TEXT NULL;
