import { mkdtemp, readdir, rm } from 'node:fs/promises';
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
});
