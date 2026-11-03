-- 缴费管理删除报名、改组别与报名信息修改截止时间。
-- AlterTable：报名信息修改截止时间，为空表示不限制。
ALTER TABLE `Tournament` ADD COLUMN `registrationEditDeadline` DATETIME(3) NULL;

-- AlterTable：签表生成后报名有删除、调出或调入，需要重新抽签。
ALTER TABLE `Event` ADD COLUMN `drawStale` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable：缴费记录区分状态变更、删除和改组别。
ALTER TABLE `PaymentLog` ADD COLUMN `action` VARCHAR(16) NOT NULL DEFAULT 'STATUS';
