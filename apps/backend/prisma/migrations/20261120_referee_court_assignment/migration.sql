CREATE TABLE `referee_court_assignment` (
    `venueId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `assignedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`venueId`, `userId`),
    INDEX `referee_court_assignment_userId_idx` (`userId`),
    CONSTRAINT `referee_court_venue_fkey` FOREIGN KEY (`venueId`) REFERENCES `Venue` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `referee_court_user_fkey` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
