import sharp from 'sharp';
import { AiConfigService } from '../ai-config/ai-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { RosterRecognitionService } from './roster-recognition.service';

describe('RosterRecognitionService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  function setup(options: { enabled?: boolean; key?: string; prompt?: string | null } = {}) {
    const prisma = {
      imageModerationConfig: {
        findUnique: jest.fn().mockResolvedValue({ id: 'default', apiKey: options.key ?? 'test-key' }),
      },
      aiConfig: { update: jest.fn().mockResolvedValue({}) },
      teamCompetition: { findUnique: jest.fn().mockResolvedValue({ id: 'comp1' }) },
    };
    const aiConfig = {
      getRawConfig: jest.fn().mockResolvedValue({
        id: 'default',
        rosterEnabled: options.enabled ?? true,
        rosterPrompt: options.prompt ?? null,
      }),
    };
    const service = new RosterRecognitionService(
      prisma as unknown as PrismaService,
      aiConfig as unknown as AiConfigService,
    );
    return { service, prisma, aiConfig };
  }

  async function image() {
    return sharp({ create: { width: 800, height: 600, channels: 3, background: '#ffffff' } }).png().toBuffer();
  }

  function reply(content: string, status = 200) {
    global.fetch = jest.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: async () => ({
        choices: [{ message: { content } }],
        usage: { prompt_tokens: 12, completion_tokens: 34 },
      }),
    }) as unknown as typeof fetch;
  }

  it('识别结果会归一化：性别、电话、队长和提示', async () => {
    const { service } = setup();
    reply(JSON.stringify({
      teams: [{
        name: ' 零一队 ',
        affiliation: '第二学校',
        members: [
          { name: '张三', gender: '男', contact: '138 0000 0000', rowNumber: 1, confidence: 0.9 },
          { name: '李四', gender: '女' },
          { name: '', gender: '男' },
        ],
      }],
      warnings: ['第 2 行联系方式被印章遮挡'],
    }));

    const result = await service.test({ buffer: await image(), mimetype: 'image/png' });

    expect(result.teams).toHaveLength(1);
    expect(result.teams[0]).toMatchObject({ name: '零一队', affiliation: '第二学校' });
    expect(result.teams[0].members).toHaveLength(2);
    expect(result.teams[0].members[0]).toMatchObject({ name: '张三', gender: 'MALE', contact: '13800000000', rowNumber: 1 });
    expect(result.teams[0].members[1]).toMatchObject({ name: '李四', gender: 'FEMALE' });
    expect(result.warnings).toEqual(['第 2 行联系方式被印章遮挡']);
    expect(result.usage).toEqual({ promptTokens: 12, completionTokens: 34 });
  });

  it('未开启时拒绝识别', async () => {
    const { service } = setup({ enabled: false });
    await expect(service.parse('comp1', { buffer: await image(), mimetype: 'image/png' }))
      .rejects.toMatchObject({ status: 400, message: expect.stringContaining('未开启') });
  });

  it('没有配置识图 Key 时给出明确提示', async () => {
    const { service } = setup({ key: '' });
    await expect(service.test({ buffer: await image(), mimetype: 'image/png' }))
      .rejects.toMatchObject({ status: 400, message: expect.stringContaining('API Key') });
  });

  it('模型返回非 JSON 时提示换图或改用 Excel', async () => {
    const { service } = setup();
    reply('看不清这张图');
    await expect(service.test({ buffer: await image(), mimetype: 'image/png' }))
      .rejects.toMatchObject({ status: 400, message: expect.stringContaining('识别结果格式') });
  });

  it('识别到 0 人时不会把空结果当成成功', async () => {
    const { service } = setup();
    reply(JSON.stringify({ teams: [], warnings: [] }));
    await expect(service.test({ buffer: await image(), mimetype: 'image/png' }))
      .rejects.toMatchObject({ status: 400 });
  });

  it('服务商异常转成可读的 503', async () => {
    const { service } = setup();
    reply('{}', 500);
    await expect(service.test({ buffer: await image(), mimetype: 'image/png' }))
      .rejects.toMatchObject({ status: 503 });
  });

  /** 拼一个内嵌多张 JPEG 页面的扫描版 PDF；每页尺寸不同，避免被当成重复图片去掉。 */
  async function scannedPdf(pageCount: number) {
    const parts: Buffer[] = [Buffer.from('%PDF-1.4\n', 'latin1')];
    for (let index = 0; index < pageCount; index += 1) {
      const width = 800 + index * 10;
      const data = await sharp({ create: { width, height: 1000, channels: 3, background: '#ffffff' } }).jpeg().toBuffer();
      parts.push(
        Buffer.from(`${index + 5} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height 1000 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${data.length} >>\nstream\n`, 'latin1'),
        data,
        Buffer.from('\nendstream\nendobj\n', 'latin1'),
      );
    }
    parts.push(Buffer.from('%%EOF\n', 'latin1'));
    return Buffer.concat(parts);
  }

  function teamReply(name: string) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ teams: [{ name, members: [{ name: `${name}队员` }] }], warnings: [] }) } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }),
    };
  }

  it('PDF 超过 6 页时直接拒绝，不调用识图接口', async () => {
    const { service } = setup();
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    await expect(service.test({ buffer: await scannedPdf(7), mimetype: 'application/pdf', originalname: 'a.pdf' }))
      .rejects.toMatchObject({ status: 400, message: expect.stringContaining('超过 6 页') });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('PDF 多页并发识别，结果仍按页序合并', async () => {
    const { service } = setup();
    const names = ['一队', '二队', '三队'];
    const delays = [40, 20, 0];
    let call = 0;
    global.fetch = jest.fn().mockImplementation(() => {
      const index = call;
      call += 1;
      return new Promise((resolve) => setTimeout(() => resolve(teamReply(names[index])), delays[index]));
    }) as unknown as typeof fetch;

    const result = await service.test({ buffer: await scannedPdf(3), mimetype: 'application/pdf', originalname: 'a.pdf' });

    expect(global.fetch).toHaveBeenCalledTimes(3);
    expect(result.teams.map((team) => team.name)).toEqual(['一队', '二队', '三队']);
    expect(result.usage).toEqual({ promptTokens: 30, completionTokens: 15 });
  });

  it('PDF 有一页失败时取消其余页的请求', async () => {
    const { service } = setup();
    let call = 0;
    let aborted = 0;
    global.fetch = jest.fn().mockImplementation((_url: string, init: { signal: AbortSignal }) => {
      call += 1;
      if (call === 1) return Promise.resolve({ ok: false, status: 500, json: async () => ({}) });
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          aborted += 1;
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        });
      });
    }) as unknown as typeof fetch;

    await expect(service.test({ buffer: await scannedPdf(3), mimetype: 'application/pdf', originalname: 'a.pdf' }))
      .rejects.toMatchObject({ status: 503 });
    expect(aborted).toBe(2);
  });

  it('总时限用完后不再发起新的识图请求', async () => {
    const { service } = setup();
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    const realNow = Date.now();
    let first = true;
    // 第一次读取作为开始时间，之后都已超过 150 秒总时限。
    jest.spyOn(Date, 'now').mockImplementation(() => {
      if (first) { first = false; return realNow; }
      return realNow + 151_000;
    });
    await expect(service.test({ buffer: await image(), mimetype: 'image/png' }))
      .rejects.toMatchObject({ status: 503, message: expect.stringContaining('超时') });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('开启开关但没有 Key 时拒绝保存', async () => {
    const { service } = setup({ key: '' });
    await expect(service.updateConfig({ enabled: true }))
      .rejects.toMatchObject({ status: 400, message: expect.stringContaining('API Key') });
  });

  it('样例测试用正在编辑的提示词；传空字符串用内置默认；不传用已保存的', async () => {
    const { service } = setup({ prompt: '已保存的提示词' });
    const sentPrompt = async (options?: { prompt?: string }) => {
      reply(JSON.stringify({ teams: [{ name: '一队', members: [{ name: '张三' }] }], warnings: [] }));
      await service.test({ buffer: await image(), mimetype: 'image/png' }, options);
      const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
      return JSON.stringify(body.messages);
    };
    expect(await sentPrompt({ prompt: '正在编辑的提示词' })).toContain('正在编辑的提示词');
    expect(await sentPrompt({ prompt: '' })).toContain('你是羽毛球赛事报名表识别器');
    expect(await sentPrompt()).toContain('已保存的提示词');
  });

  it('同一账号上一份还在识别时返回 429，识别结束（含失败）后释放名额', async () => {
    const { service } = setup();
    let finish!: () => void;
    global.fetch = jest.fn().mockImplementation(() => new Promise((resolve) => {
      finish = () => resolve({
        ok: true, status: 200,
        json: async () => ({ choices: [{ message: { content: JSON.stringify({ teams: [{ name: '一队', members: [{ name: '张三' }] }] }) } }], usage: {} }),
      });
    })) as unknown as typeof fetch;
    const first = service.parse('comp1', { buffer: await image(), mimetype: 'image/png' }, 'admin1');
    // 等第一份真正发出识图请求（图片压缩在慢机器上可能要几百毫秒）
    const fetchMock = global.fetch as jest.Mock;
    for (let i = 0; i < 400 && !fetchMock.mock.calls.length; i++) await new Promise((resolve) => setTimeout(resolve, 25));
    await expect(service.parse('comp1', { buffer: await image(), mimetype: 'image/png' }, 'admin1'))
      .rejects.toMatchObject({ status: 429, message: expect.stringContaining('还在识别') });
    finish();
    await expect(first).resolves.toMatchObject({ teams: [{ name: '一队' }] });

    reply('不是 JSON');
    await expect(service.parse('comp1', { buffer: await image(), mimetype: 'image/png' }, 'admin1')).rejects.toBeDefined();
    reply(JSON.stringify({ teams: [{ name: '二队', members: [{ name: '李四' }] }] }));
    await expect(service.parse('comp1', { buffer: await image(), mimetype: 'image/png' }, 'admin1'))
      .resolves.toMatchObject({ teams: [{ name: '二队' }] });
  });

  it('保存提示词为空时存成 null，回退到默认提示词', async () => {
    const { service, prisma } = setup();
    await service.updateConfig({ enabled: false, prompt: '   ' });
    expect(prisma.aiConfig.update).toHaveBeenCalledWith({
      where: { id: 'default' },
      data: { rosterEnabled: false, rosterPrompt: null },
    });
  });
});
