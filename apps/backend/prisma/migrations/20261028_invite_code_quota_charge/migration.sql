-- 创建邀请码时按填写的使用次数预扣发放人的邀请码余额。
-- 历史邀请码保持 false：注册成功时仍按原规则扣除（仅裁判/图片员）。
ALTER TABLE `InviteCode` ADD COLUMN `quotaCharged` BOOLEAN NOT NULL DEFAULT false;
