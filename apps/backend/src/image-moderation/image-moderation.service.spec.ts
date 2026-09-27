import { BadRequestException, ExecutionContext, INestApplication, ServiceUnavailableException, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import request from 'supertest';
import sharp from 'sharp';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { PhotosService } from '../photos/photos.service';
import { WatermarkService } from '../photos/watermark.service';
import { TournamentsController } from '../tournaments/tournaments.controller';
import { TournamentsService } from '../tournaments/tournaments.service';
import { ImageModerationController } from './image-moderation.controller';
import { ImageModerationService } from './image-moderation.service';

// A synthetic event URL QR, not personal contact information. No encoder dependency.
const qrMatrix: string[] = require('../../test/fixtures/qr-matrix.json');

async function qrImage(color = '#000000') {
  const blocks = qrMatrix.flatMap((row, y) => [...row].map((cell, x) => cell === '1'
    ? `<rect x="${(x + 4) * 8}" y="${(y + 4) * 8}" width="8" height="8"/>` : '')).join('');
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="328" height="328"><rect width="328" height="328" fill="white"/><g fill="${color}">${blocks}</g></svg>`)).png().toBuffer();
}

describe('Image moderation upload gate and ROOT settings', () => {
  let service: ImageModerationService;
  let image: Buffer;
  let fetchMock: jest.SpyInstance;
  const database = {
    imageModerationConfig: { findUnique: jest.fn(), upsert: jest.fn() },
    tournament: { findUnique: jest.fn() },
    tournamentWatermark: { findUnique: jest.fn(), upsert: jest.fn() },
    $transaction: jest.fn(),
  };
  const stored = { id: 'default', enabled: true, apiKey: 'sk-test-secret-do-not-return', updatedAt: new Date() };

  function answer(decision = 'PASS', reason = '正常赛事图片', categories: string[] = [], flags = { hasSexualContent: false, hasQrCode: false }) {
    return new Response(JSON.stringify({ choices: [{
      finish_reason: 'stop', message: { content: JSON.stringify({ decision, reason, categories, ...flags }) },
    }] }), { status: 200 });
  }

  beforeAll(async () => {
    image = await sharp({ create: { width: 256, height: 256, channels: 3, background: '#ffffff' } }).png().toBuffer();
  });

  beforeEach(() => {
    jest.resetAllMocks();
    database.imageModerationConfig.findUnique.mockResolvedValue(stored);
    database.imageModerationConfig.upsert.mockImplementation(async ({ create, update }) => ({ ...stored, ...create, ...update }));
    database.tournament.findUnique.mockResolvedValue({ id: 'fixture-tournament' });
    database.tournamentWatermark.findUnique.mockResolvedValue(null);
    service = new ImageModerationService(database as unknown as PrismaService);
    fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async () => answer());
  });

  afterEach(() => jest.restoreAllMocks());

  it('defaults off and never calls the provider when disabled', async () => {
    database.imageModerationConfig.findUnique.mockResolvedValue(null);
    expect(await service.getConfig()).toMatchObject({ enabled: false, hasApiKey: false });
    await service.assertAllowed(image);
    database.imageModerationConfig.findUnique.mockResolvedValue({ ...stored, enabled: false });
    await service.assertAllowed(image);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requires credentials to enable and keeps the stored key when the field is blank', async () => {
    database.imageModerationConfig.findUnique.mockResolvedValue(null);
    await expect(service.updateConfig({ enabled: true })).rejects.toThrow(BadRequestException);
    expect(database.imageModerationConfig.upsert).not.toHaveBeenCalled();
    database.imageModerationConfig.findUnique.mockResolvedValue(stored);
    const saved = await service.updateConfig({ enabled: false, apiKey: '   ' });
    expect(saved).toMatchObject({ enabled: false, hasApiKey: true });
    expect(database.imageModerationConfig.upsert.mock.calls[0][0].update).toEqual({ enabled: false });
    expect(JSON.stringify(saved)).not.toContain(stored.apiKey);
    expect(JSON.stringify(await service.getConfig())).not.toContain(stored.apiKey);
  });

  it('sends actual image data to the official model and accepts only a complete PASS', async () => {
    await service.assertAllowed(image);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.deepseek.com/chat/completions');
    const body = JSON.parse(options.body);
    expect(body.model).toBe('deepseek-flash');
    expect(body.thinking).toEqual({ type: 'disabled' });
    expect(body.messages[1].content[1].image_url.url).toMatch(/^data:image\/jpeg;base64,/);
    expect(body.messages[0].content).toContain('不可信');
  });

  it.each(['BLOCK', 'REVIEW'])('blocks %s without treating it as a successful upload', async (decision) => {
    fetchMock.mockResolvedValue(answer(decision, '测试原因', ['test']));
    await expect(service.assertAllowed(image)).rejects.toThrow('测试原因');
  });

  it.each([
    { hasSexualContent: true, hasQrCode: false },
    { hasSexualContent: false, hasQrCode: true },
  ])('blocks prohibited content even if the model contradicts itself with PASS: %j', async (flags) => {
    fetchMock.mockResolvedValue(answer('PASS', '模型错误地放行', [], flags));
    await expect(service.assertAllowed(image)).rejects.toThrow('禁止上传');
  });

  it.each(['sexual', 'qr_code'])('blocks explicit %s category even if the model contradicts itself with PASS', async (category) => {
    fetchMock.mockResolvedValue(answer('PASS', '模型错误地放行', [category]));
    await expect(service.assertAllowed(image)).rejects.toThrow('禁止上传');
  });

  it.each(['normal', 'colored', 'rotated', 'inverted', 'poster'])('locally blocks a %s QR without asking the model to approve it', async (variant) => {
    let qr = await qrImage(variant === 'colored' ? '#934fa3' : '#000000');
    if (variant === 'rotated') qr = await sharp(qr).rotate(90).png().toBuffer();
    if (variant === 'inverted') qr = await sharp(qr).negate({ alpha: false }).png().toBuffer();
    if (variant === 'poster') qr = await sharp({ create: { width: 1600, height: 1000, channels: 3, background: '#eeeeee' } })
      .composite([{ input: qr, left: 1230, top: 640 }]).png().toBuffer();
    await expect(service.assertAllowed(qr)).rejects.toThrow('禁止上传任何二维码');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    { choices: [] },
    { choices: [{ finish_reason: 'stop', message: { content: '' } }] },
    { choices: [{ finish_reason: 'stop', message: { content: 'not json' } }] },
    { choices: [{ finish_reason: 'length', message: { content: '{"decision":"PASS"}' } }] },
    { choices: [{ finish_reason: 'stop', message: { content: '{"decision":"PASS"}' } }] },
    { choices: [{ finish_reason: 'stop', message: { refusal: 'refused', content: '{"decision":"PASS","reason":"ok","categories":[]}' } }] },
    { choices: [{ finish_reason: 'stop', message: { content: '{"decision":"PASS","reason":"ok","categories":["violence"]}' } }] },
  ])('fails closed for incomplete, malformed or contradictory provider results %#', async (body) => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(body)));
    await expect(service.assertAllowed(image)).rejects.toThrow(ServiceUnavailableException);
  });

  it('fails closed on timeouts, HTTP failures and database failures', async () => {
    fetchMock.mockRejectedValueOnce(new DOMException('timeout', 'TimeoutError'));
    await expect(service.assertAllowed(image)).rejects.toThrow(ServiceUnavailableException);
    fetchMock.mockResolvedValueOnce(new Response(stored.apiKey, { status: 401 }));
    await expect(service.assertAllowed(image)).rejects.toThrow('图片审核服务暂不可用');
    database.imageModerationConfig.findUnique.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(service.assertAllowed(image)).rejects.toThrow(ServiceUnavailableException);
  });

  it('rejects invalid images and animations before calling DeepSeek', async () => {
    await expect(service.assertAllowed(Buffer.from('fake image'))).rejects.toThrow(BadRequestException);
    const frames = Buffer.alloc(16 * 32 * 3);
    frames.fill(255, 16 * 16 * 3);
    const animated = await sharp(frames, { raw: { width: 16, height: 32, channels: 3, pageHeight: 16 } })
      .gif({ loop: 0, delay: [100, 100] }).toBuffer();
    expect((await sharp(animated).metadata()).pages).toBe(2);
    await expect(service.assertAllowed(animated)).rejects.toThrow('不支持动图');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('tests image capability without saving the supplied key or changing the switch', async () => {
    const result = await service.testConnection({ enabled: false, apiKey: 'sk-new-test-key' });
    expect(result.success).toBe(true);
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer sk-new-test-key');
    expect(database.imageModerationConfig.upsert).not.toHaveBeenCalled();
  });

  it('bounds provider concurrency across multiple simultaneous uploads', async () => {
    let active = 0;
    let peak = 0;
    fetchMock.mockImplementation(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active--;
      return answer();
    });
    await Promise.all(Array.from({ length: 9 }, () => service.assertAllowed(image)));
    expect(peak).toBeLessThanOrEqual(3);
    expect(fetchMock).toHaveBeenCalledTimes(9);
  });

  it('never writes photo or logo files or photo rows when the verdict is BLOCK', async () => {
    fetchMock.mockImplementation(async () => answer('BLOCK', '测试拦截', ['test']));
    const watermark = { imageInfo: jest.fn() };
    const photos = new PhotosService(database as unknown as PrismaService, watermark as unknown as WatermarkService, service);
    const write = jest.spyOn(photos as unknown as { writeRelative: (path: string, buffer: Buffer) => void }, 'writeRelative').mockImplementation(() => {});
    const result = await photos.uploadPhotos('fixture-tournament', 'MATCH', [
      { originalname: 'test.png', mimetype: 'image/png', buffer: image },
    ], 'fixture-user');
    expect(result).toEqual({ uploaded: 0, failed: [{ name: 'test.png', reason: '图片未通过内容审核：测试拦截' }] });
    await expect(photos.addWatermarkLogo('fixture-tournament', { buffer: image, mimetype: 'image/png' })).rejects.toThrow('测试拦截');
    expect(write).not.toHaveBeenCalled();
    expect(watermark.imageInfo).not.toHaveBeenCalled();
    expect(database.$transaction).not.toHaveBeenCalled();
    expect(database.tournamentWatermark.upsert).not.toHaveBeenCalled();
  });

  it('gates cover uploads before the controller writes files', async () => {
    fetchMock.mockImplementation(async () => answer('BLOCK', '测试拦截', ['test']));
    const controller = new TournamentsController({} as TournamentsService, service);
    await expect(controller.uploadCover({ buffer: image })).rejects.toThrow('测试拦截');
  });

  describe('HTTP permissions and validation', () => {
    let app: INestApplication;

    beforeEach(async () => {
      const module = await Test.createTestingModule({
        controllers: [ImageModerationController],
        providers: [{ provide: ImageModerationService, useValue: service }],
      }).overrideGuard(JwtAuthGuard).useValue({
        canActivate(context: ExecutionContext) {
          const req = context.switchToHttp().getRequest();
          req.user = { role: req.headers['x-test-role'] };
          return !!req.user.role;
        },
      }).compile();
      app = module.createNestApplication();
      app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
      await app.init();
    });

    afterEach(async () => { await app.close(); });

    it.each([Role.ADMIN, Role.SUPER_ADMIN, Role.PHOTOGRAPHER, Role.PLAYER, Role.REFEREE])('denies %s access to settings, saving and connection tests', async (role) => {
      const http = request(app.getHttpServer());
      await http.get('/admin/image-moderation').set('x-test-role', role).expect(403);
      await http.patch('/admin/image-moderation').set('x-test-role', role).send({ enabled: false }).expect(403);
      await http.post('/admin/image-moderation/test').set('x-test-role', role).send({}).expect(403);
      expect(database.imageModerationConfig.upsert).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('allows ROOT and never echoes the key', async () => {
      const http = request(app.getHttpServer());
      const read = await http.get('/admin/image-moderation').set('x-test-role', Role.ROOT).expect(200);
      expect(read.body.enabled).toBe(true);
      expect(read.text).not.toContain(stored.apiKey);
      const saved = await http.patch('/admin/image-moderation').set('x-test-role', Role.ROOT).send({ enabled: false }).expect(200);
      expect(saved.body.enabled).toBe(false);
      expect(saved.text).not.toContain(stored.apiKey);
    });

    it.each([{ enabled: 'false' }, { enabled: null }, { apiKey: null }, { apiKey: 'invalid\nkey' }])('rejects invalid configuration %#', async (body) => {
      await request(app.getHttpServer()).patch('/admin/image-moderation').set('x-test-role', Role.ROOT).send(body).expect(400);
      expect(database.imageModerationConfig.upsert).not.toHaveBeenCalled();
    });
  });
});
