import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExportFilesService } from './export-files.service';

describe('ExportFilesService', () => {
  let cwd: string;
  let workDir: string;
  let fingerprint: string;
  let version: number;
  let tournamentExists: boolean;
  let service: ExportFilesService;

  const exportsService = {
    tournamentSnapshot: jest.fn((_id: string, kind: string) =>
      Promise.resolve({ kind, tournament: {}, fingerprint }),
    ),
    buildTournamentExport: jest.fn(() =>
      Promise.resolve({
        filename: 'schedule.xls',
        contentType: 'application/vnd.ms-excel',
        content: `v${version}`,
      }),
    ),
  };
  const prisma = {
    tournament: {
      findUnique: jest.fn(() =>
        Promise.resolve(tournamentExists ? { id: 't1' } : null),
      ),
    },
  };

  const storedFiles = async () =>
    (await readdir(join(workDir, 'uploads', 'exports', 't1'))).filter(
      (name) => name !== 'manifest.json',
    );

  beforeEach(async () => {
    cwd = process.cwd();
    workDir = await mkdtemp(join(tmpdir(), 'export-files-'));
    process.chdir(workDir);
    fingerprint = 'a';
    version = 1;
    tournamentExists = true;
    jest.clearAllMocks();
    service = new ExportFilesService(prisma as never, exportsService as never);
  });

  afterEach(async () => {
    process.chdir(cwd);
    await rm(workDir, { recursive: true, force: true });
  });

  it('数据未变动时复用已生成的文件', async () => {
    await service.getFresh('t1', 'schedule');
    const file = await service.getFresh('t1', 'schedule');

    expect(exportsService.buildTournamentExport).toHaveBeenCalledTimes(1);
    expect(file.content.toString()).toBe('v1');
    expect(await storedFiles()).toHaveLength(1);
  });

  it('数据变动后后台扫描重新生成文件并删除旧文件', async () => {
    await service.getFresh('t1', 'schedule');
    const [oldFile] = await storedFiles();

    fingerprint = 'b';
    version = 2;
    await service.refreshAll();

    const files = await storedFiles();
    expect(files).toHaveLength(1);
    expect(files[0]).not.toBe(oldFile);
    const file = await service.getFresh('t1', 'schedule');
    expect(file.content.toString()).toBe('v2');
    expect(exportsService.buildTournamentExport).toHaveBeenCalledTimes(2);
  });

  it('赛事删除后清理其导出目录', async () => {
    await service.getFresh('t1', 'schedule');
    tournamentExists = false;
    await service.refreshAll();

    expect(await service.list('t1')).toEqual([]);
  });

  it('强制导出时重新生成并删除上一版文件', async () => {
    await service.getFresh('t1', 'schedule', true);
    const [firstFile] = await storedFiles();

    version = 2;
    const file = await service.getFresh('t1', 'schedule', true);
    const files = await storedFiles();

    expect(exportsService.buildTournamentExport).toHaveBeenCalledTimes(2);
    expect(file.content.toString()).toBe('v2');
    expect(files).toHaveLength(1);
    expect(files[0]).not.toBe(firstFile);
  });

  it('重建时只保留最新版并删除旧文件和孤立文件', async () => {
    await service.getFresh('t1', 'schedule');
    const dir = join(workDir, 'uploads', 'exports', 't1');
    await writeFile(join(dir, 'orphan.xls'), 'orphan');

    fingerprint = 'b';
    version = 2;
    const file = await service.getFresh('t1', 'schedule');

    expect(file.content.toString()).toBe('v2');
    const files = await storedFiles();
    expect(files).toHaveLength(1);
    expect(files).not.toContain('orphan.xls');
  });

  it('导出缓存目录不可写时直接按当前数据生成并返回', async () => {
    const exportsRoot = join(workDir, 'uploads', 'exports');
    await mkdir(exportsRoot, { recursive: true });
    // 用同名文件占住赛事目录，模拟 mkdir/writeFile 被系统拒绝。
    await writeFile(join(exportsRoot, 't1'), 'blocked');

    const file = await service.getFresh('t1', 'schedule');

    expect(file.content.toString()).toBe('v1');
    expect(exportsService.buildTournamentExport).toHaveBeenCalledTimes(1);
  });

  it('报名表（含完整身份证号）不写入磁盘缓存，每次在内存里生成', async () => {
    const first = await service.getFresh('t1', 'registrations', true);
    version = 2;
    const second = await service.getFresh('t1', 'registrations');

    expect(first.content.toString()).toBe('v1');
    expect(second.content.toString()).toBe('v2');
    expect(exportsService.buildTournamentExport).toHaveBeenCalledTimes(2);
    expect(await service.list('t1')).toEqual([]);
  });

  it('以前缓存过的报名表文件：下载或后台扫描时删掉，其它导出不受影响', async () => {
    const dir = join(workDir, 'uploads', 'exports', 't1');
    await service.getFresh('t1', 'schedule');
    const [scheduleFile] = await storedFiles();
    // 模拟上线前留下的报名表缓存。
    await writeFile(join(dir, 'registrations-old.xls'), 'old');
    const manifestPath = join(dir, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.registrations = { ...manifest.schedule, kind: 'registrations', storedName: 'registrations-old.xls', size: 3 };
    await writeFile(manifestPath, JSON.stringify(manifest));

    await service.refreshAll();

    expect(await storedFiles()).toEqual([scheduleFile]);
    expect((await service.list('t1')).map((item) => item.kind)).toEqual(['schedule']);
  });
});
