-- 报名人年龄与衣服尺寸（第三方等组别可在「报名字段」里设置收集）。只加可空列，不改已有数据。
-- age：填了身份证号时按身份证和组别年龄口径计算，否则为报名人自填；shirtSize：报名人手填。
ALTER TABLE `CompetitionRegistration`
  ADD COLUMN `age` INTEGER NULL,
  ADD COLUMN `shirtSize` VARCHAR(32) NULL;

ALTER TABLE `CompetitionRegistrationEventItem`
  ADD COLUMN `partnerAge` INTEGER NULL,
  ADD COLUMN `partnerShirtSize` VARCHAR(32) NULL;
