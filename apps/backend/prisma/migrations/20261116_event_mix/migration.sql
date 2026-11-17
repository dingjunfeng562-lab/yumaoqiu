-- 混编：不同组别（或同组不同性别）的同类单项一起抽签、比赛、排名。
-- 并入的单项记下主项目 mixHostId；报名、资格、名额、缴费仍按原单项。
-- 只加一个可空列：旧数据都是 NULL（没有混编），已有签表、赛程、比分不受影响。
-- 主项目被删除时，并入的单项自动解除混编（ON DELETE SET NULL）。
ALTER TABLE `Event`
  ADD COLUMN `mixHostId` VARCHAR(191) NULL;

CREATE INDEX `Event_mixHostId_idx` ON `Event`(`mixHostId`);

ALTER TABLE `Event`
  ADD CONSTRAINT `Event_mixHostId_fkey` FOREIGN KEY (`mixHostId`) REFERENCES `Event`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
