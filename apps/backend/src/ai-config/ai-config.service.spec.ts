import { PrismaService } from '../prisma/prisma.service';
import { AiConfigService } from './ai-config.service';

describe('AiConfigService.getConfig', () => {
  it('不返回 API Key 原文和报名表识别的开关、提示词', async () => {
    const prisma = {
      aiConfig: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'default',
          provider: 'deepseek',
          modelName: 'deepseek-chat',
          apiKey: 'fake-test-key',
          enabled: true,
          rosterEnabled: true,
          rosterPrompt: '只给超级管理员看的提示词',
        }),
      },
    };
    const service = new AiConfigService(prisma as unknown as PrismaService);

    const config = await service.getConfig();

    expect(config).toMatchObject({ provider: 'deepseek', hasApiKey: true });
    expect(config).not.toHaveProperty('apiKey');
    expect(config).not.toHaveProperty('rosterEnabled');
    expect(config).not.toHaveProperty('rosterPrompt');
  });
});
