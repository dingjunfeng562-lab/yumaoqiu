-- CreateTable
CREATE TABLE `TeamDrawClearRequest` (
    `id` VARCHAR(191) NOT NULL,
    `teamCompetitionId` VARCHAR(191) NOT NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `reason` VARCHAR(500) NULL,
    `requesterId` VARCHAR(191) NOT NULL,
    `requesterNameSnapshot` VARCHAR(64) NULL,
    `decidedById` VARCHAR(191) NULL,
    `decidedByNameSnapshot` VARCHAR(64) NULL,
    `decisionRemark` VARCHAR(500) NULL,
    `decidedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `TeamDrawClearRequest_teamCompetitionId_status_idx`(`teamCompetitionId`, `status`),
    INDEX `TeamDrawClearRequest_status_createdAt_idx`(`status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `TeamDrawClearRequest` ADD CONSTRAINT `TeamDrawClearRequest_teamCompetitionId_fkey` FOREIGN KEY (`teamCompetitionId`) REFERENCES `TeamCompetition`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TeamDrawClearRequest` ADD CONSTRAINT `TeamDrawClearRequest_requesterId_fkey` FOREIGN KEY (`requesterId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TeamDrawClearRequest` ADD CONSTRAINT `TeamDrawClearRequest_decidedById_fkey` FOREIGN KEY (`decidedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
