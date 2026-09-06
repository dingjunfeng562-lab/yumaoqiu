CREATE TABLE `ai_config` (
    `id` VARCHAR(191) NOT NULL,
    `provider` VARCHAR(64) NOT NULL DEFAULT 'openai',
    `model_name` VARCHAR(128) NOT NULL DEFAULT 'gpt-4o-mini',
    `api_key` VARCHAR(512) NOT NULL DEFAULT '',
    `api_base` VARCHAR(512) NOT NULL DEFAULT 'https://api.openai.com/v1',
    `system_prompt` TEXT NOT NULL,
    `max_tokens` INTEGER NOT NULL DEFAULT 2048,
    `temperature` DOUBLE NOT NULL DEFAULT 0.7,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `welcome_message` VARCHAR(500) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `ai_config` (
    `id`,
    `provider`,
    `model_name`,
    `api_key`,
    `api_base`,
    `system_prompt`,
    `max_tokens`,
    `temperature`,
    `enabled`,
    `welcome_message`,
    `createdAt`,
    `updatedAt`
) VALUES (
    'default',
    'openai',
    'gpt-4o-mini',
    '',
    'https://api.openai.com/v1',
    '你是羽动云赛的 AI 助手，一个羽毛球赛事管理平台的智能客服。请用简洁友好的中文回答用户关于赛事、报名、赛程、规则等问题。',
    2048,
    0.7,
    true,
    '你好！我是羽动云赛的 AI 小助手，有什么关于赛事的问题可以问我哦。',
    CURRENT_TIMESTAMP(3),
    CURRENT_TIMESTAMP(3)
);
