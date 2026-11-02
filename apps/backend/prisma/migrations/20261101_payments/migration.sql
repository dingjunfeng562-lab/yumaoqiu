-- 缴费管理：组别收费设置、报名/队伍缴费状态、缴费变更记录。
-- AlterTable
ALTER TABLE `Registration` ADD COLUMN `paidAmount` INTEGER NULL,
    ADD COLUMN `paidAt` DATETIME(3) NULL,
    ADD COLUMN `paymentConfirmedById` VARCHAR(191) NULL,
    ADD COLUMN `paymentNote` VARCHAR(255) NULL,
    ADD COLUMN `paymentStatus` ENUM('UNPAID', 'PAID', 'WAIVED') NOT NULL DEFAULT 'UNPAID';

-- AlterTable
ALTER TABLE `Team` ADD COLUMN `paidAmount` INTEGER NULL,
    ADD COLUMN `paidAt` DATETIME(3) NULL,
    ADD COLUMN `paymentConfirmedById` VARCHAR(191) NULL,
    ADD COLUMN `paymentNote` VARCHAR(255) NULL,
    ADD COLUMN `paymentStatus` ENUM('UNPAID', 'PAID', 'WAIVED') NOT NULL DEFAULT 'UNPAID';

-- CreateTable
CREATE TABLE `TournamentPaymentSetting` (
    `id` VARCHAR(191) NOT NULL,
    `tournamentId` VARCHAR(191) NOT NULL,
    `entrantType` ENUM('SCHOOL', 'SOCIAL') NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT false,
    `singlesFee` INTEGER NOT NULL DEFAULT 0,
    `doublesFee` INTEGER NOT NULL DEFAULT 0,
    `teamFee` INTEGER NOT NULL DEFAULT 0,
    `instructions` TEXT NULL,
    `qrImageUrl` VARCHAR(255) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `TournamentPaymentSetting_tournamentId_entrantType_key`(`tournamentId`, `entrantType`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PaymentLog` (
    `id` VARCHAR(191) NOT NULL,
    `tournamentId` VARCHAR(191) NOT NULL,
    `entrantType` ENUM('SCHOOL', 'SOCIAL') NOT NULL,
    `registrationId` VARCHAR(191) NULL,
    `teamId` VARCHAR(191) NULL,
    `targetName` VARCHAR(191) NOT NULL,
    `itemName` VARCHAR(120) NOT NULL,
    `fromStatus` ENUM('UNPAID', 'PAID', 'WAIVED') NOT NULL,
    `toStatus` ENUM('UNPAID', 'PAID', 'WAIVED') NOT NULL,
    `amount` INTEGER NULL,
    `note` VARCHAR(255) NULL,
    `operatorId` VARCHAR(191) NULL,
    `operatorName` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PaymentLog_tournamentId_createdAt_idx`(`tournamentId`, `createdAt`),
    INDEX `PaymentLog_registrationId_idx`(`registrationId`),
    INDEX `PaymentLog_teamId_idx`(`teamId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `Player_name_idx` ON `Player`(`name`);

-- AddForeignKey
ALTER TABLE `TournamentPaymentSetting` ADD CONSTRAINT `TournamentPaymentSetting_tournamentId_fkey` FOREIGN KEY (`tournamentId`) REFERENCES `Tournament`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PaymentLog` ADD CONSTRAINT `PaymentLog_tournamentId_fkey` FOREIGN KEY (`tournamentId`) REFERENCES `Tournament`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

