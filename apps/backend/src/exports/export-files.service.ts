import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { extname, join } from 'node:path';
import { PrismaService } from '../prisma/prisma.service';
import { EXPORT_KINDS, ExportKind, ExportsService } from './exports.service';

const SCAN_INTERVAL_MS = 30_000;
const MANIFEST_FILE = 'manifest.json';

type StoredExport = {
  kind: ExportKind;
  filename: string;
  storedName: string;
  contentType: string;
  size: number;
  fingerprint: string;
  generatedAt: string;
};
type Manifest = Partial<Record<ExportKind, StoredExport>>;

/**
 * 已生成导出文件的持久化与自动重建：
 * - 首次导出后文件保存在 uploads/exports/<赛事ID>/，并记录生成时的数据指纹；
 * - 下载时及后台每 30 秒对比一次指纹，赛事数据有变动就重新生成文件，并删除上一个文件。
 */
@Injectable()
export class ExportFilesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ExportFilesService.name);
  private timer: NodeJS.Timeout | null = null;
  private scanning = false;
  // 同一赛事的 manifest 读写串行化，避免下载与后台扫描同时重建。
  private locks = new Map<string, Promise<unknown>>();

  constructor(
    private prisma: PrismaService,
    private exportsService: ExportsService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      void this.refreshAll();
    }, SCAN_INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** 列出该赛事已生成的导出文件（不含文件内容）。 */
  async list(tournamentId: string) {
    const manifest = await this.readManifest(tournamentId);
    return EXPORT_KINDS.flatMap((kind) => {
      const item = manifest[kind];
      return item
        ? [
            {
              kind,
              filename: item.filename,
              size: item.size,
              generatedAt: item.generatedAt,
            },
          ]
        : [];
    });
  }

  /** 取最新的导出文件：没有或数据已变动则重新生成（并删除旧文件）。 */
  async getFresh(tournamentId: string, kind: string) {
    return this.withLock(tournamentId, async () => {
      const snapshot = await this.exportsService.tournamentSnapshot(
        tournamentId,
        kind,
      );
      const manifest = await this.readManifest(tournamentId);
      const current = manifest[snapshot.kind];
      const item =
        current?.fingerprint === snapshot.fingerprint &&
        existsSync(this.filePath(tournamentId, current.storedName))
          ? current
          : await this.rebuild(tournamentId, snapshot, manifest);
      // 在锁内读取，避免读到一半被并发重建删除。
      return {
        filename: item.filename,
        contentType: item.contentType,
        content: await readFile(this.filePath(tournamentId, item.storedName)),
      };
    });
  }

  /** 后台扫描：只处理已生成过的文件，数据有变动就重建；赛事已删除则清理其导出目录。 */
  async refreshAll() {
    if (this.scanning) return;
    this.scanning = true;
    try {
      const root = this.rootDir();
      if (!existsSync(root)) return;
      const tournamentIds = (await readdir(root, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);

      for (const tournamentId of tournamentIds) {
        const exists = await this.prisma.tournament.findUnique({
          where: { id: tournamentId },
          select: { id: true },
        });
        if (!exists) {
          await this.withLock(tournamentId, () =>
            rm(this.tournamentDir(tournamentId), {
              recursive: true,
              force: true,
            }),
          );
          continue;
        }

        const kinds = Object.keys(
          await this.readManifest(tournamentId),
        ) as ExportKind[];
        for (const kind of kinds) {
          try {
            await this.withLock(tournamentId, async () => {
              const snapshot = await this.exportsService.tournamentSnapshot(
                tournamentId,
                kind,
              );
              const manifest = await this.readManifest(tournamentId);
              const current = manifest[kind];
              // 扫描期间文件可能已被删除或刚被下载请求重建过。
              if (!current || current.fingerprint === snapshot.fingerprint)
                return;
              await this.rebuild(tournamentId, snapshot, manifest);
            });
          } catch (error) {
            this.logger.error(
              `导出文件自动重建失败（赛事 ${tournamentId}，${kind}）：${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
      }
    } catch (error) {
      this.logger.error(
        `导出文件扫描失败：${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.scanning = false;
    }
  }

  private async rebuild(
    tournamentId: string,
    snapshot: Awaited<ReturnType<ExportsService['tournamentSnapshot']>>,
    manifest: Manifest,
  ) {
    const file = await this.exportsService.buildTournamentExport(
      snapshot.tournament,
      snapshot.kind,
    );
    const isBinary = Buffer.isBuffer(file.content);
    const content = isBinary
      ? (file.content as Buffer)
      : Buffer.from(file.content as string, 'utf8');
    const storedName = `${snapshot.kind}-${Date.now()}-${randomBytes(4).toString('hex')}${extname(file.filename)}`;

    await mkdir(this.tournamentDir(tournamentId), { recursive: true });
    await writeFile(this.filePath(tournamentId, storedName), content);

    const previous = manifest[snapshot.kind];
    const item: StoredExport = {
      kind: snapshot.kind,
      filename: file.filename,
      storedName,
      contentType: isBinary
        ? file.contentType
        : `${file.contentType}; charset=utf-8`,
      size: content.length,
      fingerprint: snapshot.fingerprint,
      generatedAt: new Date().toISOString(),
    };
    await this.writeManifest(tournamentId, {
      ...manifest,
      [snapshot.kind]: item,
    });

    // 新文件和 manifest 落盘后再删旧文件，中途失败也不会丢失可下载的文件。
    if (previous && previous.storedName !== storedName) {
      await rm(this.filePath(tournamentId, previous.storedName), {
        force: true,
      });
    }
    if (previous)
      this.logger.log(
        `赛事 ${tournamentId} 的${file.filename}已因数据变动重新生成`,
      );
    return item;
  }

  private async withLock<T>(
    tournamentId: string,
    task: () => Promise<T>,
  ): Promise<T> {
    const previous = this.locks.get(tournamentId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(task);
    this.locks.set(tournamentId, next);
    try {
      return await next;
    } finally {
      if (this.locks.get(tournamentId) === next)
        this.locks.delete(tournamentId);
    }
  }

  private async readManifest(tournamentId: string): Promise<Manifest> {
    try {
      return JSON.parse(
        await readFile(
          join(this.tournamentDir(tournamentId), MANIFEST_FILE),
          'utf8',
        ),
      ) as Manifest;
    } catch {
      return {};
    }
  }

  private async writeManifest(tournamentId: string, manifest: Manifest) {
    const target = join(this.tournamentDir(tournamentId), MANIFEST_FILE);
    const temp = `${target}.${randomBytes(4).toString('hex')}.tmp`;
    await writeFile(temp, JSON.stringify(manifest, null, 2), 'utf8');
    await rename(temp, target);
  }

  private rootDir() {
    return join(process.cwd(), 'uploads', 'exports');
  }

  private tournamentDir(tournamentId: string) {
    // 赛事 ID 用作目录名，只允许安全字符，防止路径穿越。
    if (!/^[A-Za-z0-9_-]+$/.test(tournamentId))
      throw new NotFoundException('赛事不存在');
    return join(this.rootDir(), tournamentId);
  }

  private filePath(tournamentId: string, storedName: string) {
    return join(this.tournamentDir(tournamentId), storedName);
  }
}
