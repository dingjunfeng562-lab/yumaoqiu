-- AlterTable
ALTER TABLE `TeamCompetition` ADD COLUMN `advancePerGroup` INTEGER NULL,
    ADD COLUMN `format` ENUM('SINGLE_ELIMINATION', 'ROUND_ROBIN', 'GROUP_ROUND_ROBIN', 'GROUP_PLUS_KNOCKOUT') NOT NULL DEFAULT 'SINGLE_ELIMINATION',
    ADD COLUMN `groupCount` INTEGER NULL,
    ADD COLUMN `teamsPerGroup` INTEGER NULL;

-- AlterTable
ALTER TABLE `TeamMatch` ADD COLUMN `groupId` VARCHAR(191) NULL,
    ADD COLUMN `stage` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `TeamGroup` (
    `id` VARCHAR(191) NOT NULL,
    `teamCompetitionId` VARCHAR(191) NOT NULL,
    `groupNo` INTEGER NOT NULL,
    `groupName` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `TeamGroup_teamCompetitionId_idx`(`teamCompetitionId`),
    UNIQUE INDEX `TeamGroup_teamCompetitionId_groupNo_key`(`teamCompetitionId`, `groupNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TeamGroupMember` (
    `id` VARCHAR(191) NOT NULL,
    `groupId` VARCHAR(191) NOT NULL,
    `teamId` VARCHAR(191) NOT NULL,
    `seedOrder` INTEGER NULL,
    `wins` INTEGER NOT NULL DEFAULT 0,
    `losses` INTEGER NOT NULL DEFAULT 0,
    `matchesWon` INTEGER NOT NULL DEFAULT 0,
    `matchesLost` INTEGER NOT NULL DEFAULT 0,
    `netMatches` INTEGER NOT NULL DEFAULT 0,
    `groupRank` INTEGER NULL,
    `advanced` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `TeamGroupMember_teamId_idx`(`teamId`),
    INDEX `TeamGroupMember_groupId_groupRank_idx`(`groupId`, `groupRank`),
    UNIQUE INDEX `TeamGroupMember_groupId_teamId_key`(`groupId`, `teamId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `TeamMatch_groupId_idx` ON `TeamMatch`(`groupId`);

-- AddForeignKey
ALTER TABLE `TeamMatch` ADD CONSTRAINT `TeamMatch_groupId_fkey` FOREIGN KEY (`groupId`) REFERENCES `TeamGroup`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TeamGroup` ADD CONSTRAINT `TeamGroup_teamCompetitionId_fkey` FOREIGN KEY (`teamCompetitionId`) REFERENCES `TeamCompetition`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TeamGroupMember` ADD CONSTRAINT `TeamGroupMember_groupId_fkey` FOREIGN KEY (`groupId`) REFERENCES `TeamGroup`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TeamGroupMember` ADD CONSTRAINT `TeamGroupMember_teamId_fkey` FOREIGN KEY (`teamId`) REFERENCES `Team`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
