import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import {
  MatchScoreSheetService,
  canonicalJson,
  scoreSheetContentHash,
  sha256Hex,
} from './match-score-sheet.service';
import { renderScoreSheetPng } from './score-sheet-render';
import type { ScoreSheetSide, ScoreSheetSnapshot } from './score-sheet.types';

async function signaturePng(withInk = true, width = 600, height = 200) {
  const stroke = withInk
    ? '<path d="M20 150 C 120 20, 220 180, 320 60 S 520 160, 580 40" stroke="#000" stroke-width="6" fill="none"/>'
    : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${stroke}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

function dataUrl(buffer: Buffer) {
  return `data:image/png;base64,${buffer.toString('base64')}`;
}

const doubles: ScoreSheetSide = {
  name: '张三 / 李四',
  teamName: null,
  affiliation: '一中 / 二中',
  players: [
    { index: 1, name: '张三', affiliation: '一中' },
    { index: 2, name: '李四', affiliation: '二中' },
  ],
};
const singles: ScoreSheetSide = {
  name: '王五',
  teamName: null,
  affiliation: '三中',
  players: [{ index: 1, name: '王五', affiliation: '三中' }],
};

function snapshot(): ScoreSheetSnapshot {
  return {
    version: 1,
    tournament: { id: 't1', name: '测试羽毛球赛', edition: 1 },
    matchId: 'm1',
    eventLabel: '学生组 · 男子双打',
    roundLabel: '半决赛',
    matchLabel: '半决赛 · 第 1 场',
    matchNo: 1,
    venue: '1号场',
    scheduledAt: '2026-11-12T01:00:00.000Z',
    startedAt: '2026-11-12T01:02:00.000Z',
    finishedAt: '2026-11-12T01:40:30.000Z',
    durationSeconds: 2310,
    side1: doubles,
    side2: singles,
    games: [
      { gameNo: 1, side1Score: 21, side2Score: 15, winnerSide: 1 },
      { gameNo: 2, side1Score: 21, side2Score: 19, winnerSide: 1 },
    ],
    side1Games: 2,
    side2Games: 0,
    winnerSide: 1,
    endType: 'NORMAL',
    endReason: null,
    points: [{ gameNo: 1, scores: [[1, 0], [1, 1], [2, 1]] }],
    referee: { id: 'u1', name: 'referee01' },
  };
}

describe('MatchScoreSheetService', () => {
  let workDir: string;
  let cwdSpy: jest.SpyInstance;
  const prisma = {
    tournament: { findUnique: jest.fn(), update: jest.fn() },
    matchScoreSheet: { findMany: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
  };
  const service = new MatchScoreSheetService(prisma as any);

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'score-sheet-'));
    cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(workDir);
    jest.clearAllMocks();
  });

  afterEach(() => {
    cwdSpy.mockRestore();
    rmSync(workDir, { recursive: true, force: true });
  });

  it('指纹与 JSON 键序无关，改任何一个数都会变', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, 2], c: null } })).toBe(canonicalJson({ a: { c: null, d: [1, 2] }, b: 1 }));
    const base = {
      sheetId: 's1',
      matchId: 'm1',
      snapshot: snapshot(),
      winnerSignerName: '张三',
      winnerSignatureSha256: 'a'.repeat(64),
      refereeSignatureSha256: 'b'.repeat(64),
      signedAt: new Date('2026-11-12T01:41:00.123Z'),
    };
    // 数据库取回的 JSON 键序可能和写入时不同。
    const reordered = Object.fromEntries(Object.entries(snapshot()).reverse());
    expect(scoreSheetContentHash({ ...base, snapshot: reordered })).toBe(scoreSheetContentHash(base));
    const tampered = snapshot();
    tampered.games[1].side2Score = 20;
    expect(scoreSheetContentHash({ ...base, snapshot: tampered })).not.toBe(scoreSheetContentHash(base));
  });

  it('只收有笔迹的 PNG 签名', async () => {
    await expect(service.decodeSignature(undefined, '胜方')).rejects.toThrow('请先完成胜方签字');
    await expect(service.decodeSignature('data:image/jpeg;base64,AAAA', '胜方')).rejects.toThrow('格式不对');
    await expect(service.decodeSignature(dataUrl(await signaturePng(false)), '裁判')).rejects.toThrow('空白');
    await expect(service.decodeSignature(dataUrl(await signaturePng(true, 20, 10)), '裁判')).rejects.toThrow('尺寸');
    const image = await service.decodeSignature(dataUrl(await signaturePng()), '裁判');
    expect(image.subarray(1, 4).toString()).toBe('PNG');
  });

  it('双打必须说明胜方由谁签，单打自动是唯一的选手；双方弃权只要裁判签', async () => {
    const winnerSignature = dataUrl(await signaturePng());
    const refereeSignature = dataUrl(await signaturePng());
    await expect(service.prepareSignatures(
      { winnerSignature, refereeSignature },
      { required: true, side: doubles },
    )).rejects.toThrow('请选择胜方由哪位选手签字');

    const pair = await service.prepareSignatures(
      { winnerSignature, winnerSignerIndex: 2, refereeSignature },
      { required: true, side: doubles },
    );
    expect(pair.winner).toMatchObject({ signerIndex: 2, signerName: '李四' });

    const single = await service.prepareSignatures({ winnerSignature, refereeSignature }, { required: true, side: singles });
    expect(single.winner).toMatchObject({ signerIndex: 1, signerName: '王五' });

    await expect(service.prepareSignatures({ refereeSignature }, { required: true, side: singles }))
      .rejects.toThrow('请先完成胜方签字');

    const both = await service.prepareSignatures({ refereeSignature }, { required: false, side: null });
    expect(both.winner).toBeNull();
    expect(both.referee.sha256).toBe(sha256Hex(both.referee.image));
  });

  it('签名先落盘，事务失败时删掉；路径只能在 match-signatures 下', async () => {
    const prepared = await service.prepareSignatures(
      { winnerSignature: dataUrl(await signaturePng()), refereeSignature: dataUrl(await signaturePng()) },
      { required: true, side: singles },
    );
    const files = await service.writeSignatureFiles('t1', 'm1', 'sheet1', prepared);
    expect(files).toEqual({
      winnerPath: 'match-signatures/t1/m1/sheet1-winner.png',
      refereePath: 'match-signatures/t1/m1/sheet1-referee.png',
    });
    const winnerFile = join(workDir, 'uploads', 'match-signatures', 't1', 'm1', 'sheet1-winner.png');
    expect(readFileSync(winnerFile).equals(prepared.winner!.image)).toBe(true);

    await service.discardFiles({ sheetId: 'sheet1', tournamentId: 't1', prepared, files, side1: null, side2: null });
    expect(existsSync(winnerFile)).toBe(false);

    await expect(service.writeSignatureFiles('../x', 'm1', 'sheet2', prepared)).rejects.toThrow('场次编号无效');
    await expect(service.resolveFile('m1', '../../etc', 'sheet')).rejects.toThrow('比分单不存在');
  });

  it('同一事务里先作废同场旧记录，再写新记录和指纹', async () => {
    const prepared = await service.prepareSignatures(
      { winnerSignature: dataUrl(await signaturePng()), winnerSignerIndex: 1, refereeSignature: dataUrl(await signaturePng()) },
      { required: true, side: doubles },
    );
    const tx = { matchScoreSheet: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), create: jest.fn() } };
    const signedAt = new Date('2026-11-12T01:41:00.000Z');
    await service.createRecord(tx as any, {
      signing: {
        sheetId: 'sheet1',
        tournamentId: 't1',
        prepared,
        files: { winnerPath: 'match-signatures/t1/m1/sheet1-winner.png', refereePath: 'match-signatures/t1/m1/sheet1-referee.png' },
        side1: doubles,
        side2: singles,
      },
      matchId: 'm1',
      snapshot: snapshot(),
      refereeId: 'u1',
      refereeName: 'referee01',
      matchFinishedAt: new Date('2026-11-12T01:40:30.000Z'),
      signedAt,
      meta: { ip: '1.2.3.4', userAgent: 'jest' },
    });
    expect(tx.matchScoreSheet.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { matchId: 'm1', status: 'VALID' },
      data: expect.objectContaining({ status: 'VOID' }),
    }));
    const data = tx.matchScoreSheet.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      id: 'sheet1',
      endType: 'NORMAL',
      winnerSide: 1,
      winnerSignerIndex: 1,
      winnerSignerName: '张三',
      refereeName: 'referee01',
      clientIp: '1.2.3.4',
    });
    expect(data.contentHash).toBe(scoreSheetContentHash({
      sheetId: 'sheet1',
      matchId: 'm1',
      snapshot: snapshot(),
      winnerSignerName: '张三',
      winnerSignatureSha256: prepared.winner!.sha256,
      refereeSignatureSha256: prepared.referee.sha256,
      signedAt,
    }));
  });

  it('校验能发现被替换的签名文件，比分结果变了显示为已失效', async () => {
    const referee = await signaturePng();
    const winner = await signaturePng();
    const dir = join(workDir, 'uploads', 'match-signatures', 't1', 'm1');
    const prepared = { winner: { image: winner, sha256: sha256Hex(winner), signerIndex: 1, signerName: '张三' }, referee: { image: referee, sha256: sha256Hex(referee) } };
    await service.writeSignatureFiles('t1', 'm1', 'sheet1', prepared);
    const signedAt = new Date('2026-11-12T01:41:00.000Z');
    const row = {
      id: 'sheet1',
      matchId: 'm1',
      tournamentId: 't1',
      endType: 'NORMAL',
      winnerSide: 1,
      winnerSignerIndex: 1,
      winnerSignerName: '张三',
      winnerSignaturePath: 'match-signatures/t1/m1/sheet1-winner.png',
      winnerSignatureSha256: sha256Hex(winner),
      refereeId: 'u1',
      refereeName: 'referee01',
      refereeSignaturePath: 'match-signatures/t1/m1/sheet1-referee.png',
      refereeSignatureSha256: sha256Hex(referee),
      sheetPath: null,
      sheetSha256: null,
      snapshot: snapshot(),
      contentHash: scoreSheetContentHash({
        sheetId: 'sheet1',
        matchId: 'm1',
        snapshot: snapshot(),
        winnerSignerName: '张三',
        winnerSignatureSha256: sha256Hex(winner),
        refereeSignatureSha256: sha256Hex(referee),
        signedAt,
      }),
      matchFinishedAt: new Date('2026-11-12T01:40:30.000Z'),
      clientIp: null,
      userAgent: null,
      signedAt,
      status: 'VALID',
      voidedAt: null,
      voidReason: null,
      voidedById: null,
      match: { status: 'COMPLETED', finishedAt: new Date('2026-11-12T01:40:30.000Z') },
    };
    prisma.matchScoreSheet.findMany.mockResolvedValue([row]);
    const [ok] = await service.listForMatch('m1');
    expect(ok.integrity).toEqual({ ok: true, problems: [] });
    expect(ok.status).toBe('VALID');
    expect(ok.scoreText).toBe('21:15 / 21:19');

    writeFileSync(join(dir, 'sheet1-winner.png'), await signaturePng(true, 400, 150));
    prisma.matchScoreSheet.findMany.mockResolvedValue([
      { ...row, match: { status: 'LIVE', finishedAt: null } },
    ]);
    const [bad] = await service.listForMatch('m1');
    expect(bad.integrity.ok).toBe(false);
    expect(bad.integrity.problems).toContain('胜方签名图片和记录的指纹不一致');
    expect(bad.status).toBe('STALE');
  });

  it('能把快照和签名画成比分单 PNG', async () => {
    const image = await renderScoreSheetPng({
      sheetId: 'sheet1',
      snapshot: snapshot(),
      signedAt: new Date('2026-11-12T01:41:00.000Z'),
      contentHash: 'c'.repeat(64),
      winnerSignerName: '张三',
      winnerSignature: await signaturePng(),
      refereeSignature: await signaturePng(),
    });
    const metadata = await sharp(image).metadata();
    expect(metadata.format).toBe('png');
    expect(metadata.width).toBe(1240);
    expect(metadata.height).toBeGreaterThan(1200);
    expect(metadata.height).toBeLessThan(4800);
  });
});
