import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { MatchScoreSheet, MatchStatus, Prisma, ScoreSheetStatus } from '@prisma/client';
import sharp from 'sharp';
import { PrismaService } from '../prisma/prisma.service';
import { renderScoreSheetPng } from './score-sheet-render';
import {
  SCORE_SHEET_END_TYPE_LABELS,
  type MatchSignatureInput,
  type PreparedSignatures,
  type ScoreSheetEndType,
  type ScoreSheetFiles,
  type ScoreSheetRequestMeta,
  type ScoreSheetSide,
  type ScoreSheetSigning,
  type ScoreSheetSnapshot,
} from './score-sheet.types';

/** 签名和比分单都放在 uploads/match-signatures/<赛事>/<场次>/ 下，不走公开的 /api/uploads 路由。 */
const SIGNATURE_DIR = 'match-signatures';
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const PNG_DATA_URL = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** 单张签名解码后的上限。前端导出的签名一般只有十几 KB；两张加起来还要放进 100KB 的请求体。 */
export const MAX_SIGNATURE_BYTES = 64 * 1024;
/** 少于这么多「有墨」像素就当作没签。 */
const MIN_INK_PIXELS = 60;

export type ScoreSheetFileKind = 'sheet' | 'winner' | 'referee';
export type ScoreSheetEffectiveStatus = 'VALID' | 'VOID' | 'STALE';

/** 键名排序后的 JSON：数据库取回的 JSON 键序可能变，算指纹必须和键序无关。 */
export function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
  return `{${entries.join(',')}}`;
}

export function sha256Hex(content: Buffer | string) {
  return createHash('sha256').update(content).digest('hex');
}

/** 比分单的防篡改指纹：比分快照 + 两张签名的 SHA-256 + 签字人 + 签字时间。 */
export function scoreSheetContentHash(input: {
  sheetId: string;
  matchId: string;
  snapshot: unknown;
  winnerSignerName: string | null;
  winnerSignatureSha256: string | null;
  refereeSignatureSha256: string;
  signedAt: Date;
}) {
  return sha256Hex(canonicalJson({
    v: 1,
    sheetId: input.sheetId,
    matchId: input.matchId,
    snapshot: input.snapshot,
    winnerSignerName: input.winnerSignerName ?? null,
    winnerSignatureSha256: input.winnerSignatureSha256 ?? null,
    refereeSignatureSha256: input.refereeSignatureSha256,
    signedAt: input.signedAt.toISOString(),
  }));
}

function clip(value: string | null | undefined, max: number) {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

type SheetWithMatch = MatchScoreSheet & { match: { status: MatchStatus; finishedAt: Date | null } };

@Injectable()
export class MatchScoreSheetService {
  private readonly logger = new Logger(MatchScoreSheetService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------- 开关

  async isRequired(tournamentId: string | null | undefined) {
    if (!tournamentId) return false;
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
      select: { requireMatchSignature: true },
    });
    return Boolean(tournament?.requireMatchSignature);
  }

  async getSetting(tournamentId: string) {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
      select: { id: true, requireMatchSignature: true },
    });
    if (!tournament) throw new NotFoundException('赛事不存在');
    return { tournamentId: tournament.id, requireMatchSignature: tournament.requireMatchSignature };
  }

  async updateSetting(tournamentId: string, enabled: boolean) {
    await this.getSetting(tournamentId);
    const tournament = await this.prisma.tournament.update({
      where: { id: tournamentId },
      data: { requireMatchSignature: enabled },
      select: { id: true, requireMatchSignature: true },
    });
    return { tournamentId: tournament.id, requireMatchSignature: tournament.requireMatchSignature };
  }

  // ---------------------------------------------------------------- 签名校验与落盘

  /** 校验一张签名：必须是 PNG data URL、大小和尺寸合理、不能是空白。 */
  async decodeSignature(dataUrl: unknown, label: string): Promise<Buffer> {
    if (typeof dataUrl !== 'string' || !dataUrl.trim()) {
      throw new BadRequestException(`请先完成${label}签字`);
    }
    const matched = PNG_DATA_URL.exec(dataUrl.trim());
    if (!matched) throw new BadRequestException(`${label}签名格式不对，请清除后重签`);
    const image = Buffer.from(matched[1], 'base64');
    if (!image.length || image.length > MAX_SIGNATURE_BYTES) {
      throw new BadRequestException(`${label}签名图片过大，请清除后重签`);
    }
    if (image.length < PNG_MAGIC.length || !image.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) {
      throw new BadRequestException(`${label}签名格式不对，请清除后重签`);
    }
    let width = 0;
    let height = 0;
    let ink = 0;
    try {
      const metadata = await sharp(image).metadata();
      if (metadata.format !== 'png') throw new Error('not png');
      width = metadata.width ?? 0;
      height = metadata.height ?? 0;
      const { data } = await sharp(image)
        .flatten({ background: '#ffffff' })
        .greyscale()
        .raw()
        .toBuffer({ resolveWithObject: true });
      for (let index = 0; index < data.length; index += 1) {
        if (data[index] < 160) ink += 1;
      }
    } catch {
      throw new BadRequestException(`${label}签名图片已损坏，请清除后重签`);
    }
    if (width < 40 || height < 20 || width > 2000 || height > 1200) {
      throw new BadRequestException(`${label}签名图片尺寸不对，请清除后重签`);
    }
    if (ink < MIN_INK_PIXELS) throw new BadRequestException(`${label}签名几乎是空白，请重新签字`);
    return image;
  }

  /**
   * 校验本次提交的签名。winner.required=false 只在双方弃权（无胜方）时出现，此时只要裁判签字。
   * 双打由胜方两人中的一人签，必须说明是谁。
   */
  async prepareSignatures(
    input: MatchSignatureInput,
    winner: { required: boolean; side: ScoreSheetSide | null },
  ): Promise<PreparedSignatures> {
    let winnerPart: PreparedSignatures['winner'] = null;
    if (winner.required) {
      const image = await this.decodeSignature(input.winnerSignature, '胜方');
      const players = winner.side?.players ?? [];
      let signerIndex: number | null = null;
      if (players.length > 1) {
        const chosen = Number(input.winnerSignerIndex);
        if (!Number.isInteger(chosen) || chosen < 1 || chosen > players.length) {
          throw new BadRequestException('请选择胜方由哪位选手签字');
        }
        signerIndex = chosen;
      } else if (players.length === 1) {
        signerIndex = 1;
      }
      const signer = signerIndex ? players.find((player) => player.index === signerIndex) ?? players[signerIndex - 1] : null;
      winnerPart = {
        image,
        sha256: sha256Hex(image),
        signerIndex,
        signerName: clip(signer?.name ?? winner.side?.name ?? null, 100),
      };
    }
    const referee = await this.decodeSignature(input.refereeSignature, '裁判');
    return { winner: winnerPart, referee: { image: referee, sha256: sha256Hex(referee) } };
  }

  createSheetId() {
    return randomUUID().replace(/-/g, '');
  }

  private uploadsRoot() {
    return join(process.cwd(), 'uploads');
  }

  /** 相对路径 → 绝对路径；只认 match-signatures/ 下、不含 .. 的路径。 */
  private absolutePath(relative: string) {
    const parts = relative.replace(/\\/g, '/').split('/');
    if (parts[0] !== SIGNATURE_DIR || parts.some((part) => !part || part === '.' || part === '..')) {
      throw new NotFoundException('文件不存在');
    }
    return join(this.uploadsRoot(), ...parts);
  }

  private matchDirectory(tournamentId: string, matchId: string) {
    if (!SAFE_ID.test(tournamentId) || !SAFE_ID.test(matchId)) throw new BadRequestException('场次编号无效');
    return `${SIGNATURE_DIR}/${tournamentId}/${matchId}`;
  }

  private sheetImagePath(row: { id: string; refereeSignaturePath: string }) {
    const directory = row.refereeSignaturePath.split('/').slice(0, -1).join('/');
    return `${directory}/${row.id}-sheet.png`;
  }

  /** 先把签名写到磁盘，再在结束比赛的事务里落库；事务失败时调用 discardFiles 删掉。 */
  async writeSignatureFiles(
    tournamentId: string,
    matchId: string,
    sheetId: string,
    prepared: PreparedSignatures,
  ): Promise<ScoreSheetFiles> {
    const directory = this.matchDirectory(tournamentId, matchId);
    await mkdir(this.absolutePath(directory), { recursive: true });
    const refereePath = `${directory}/${sheetId}-referee.png`;
    const winnerPath = prepared.winner ? `${directory}/${sheetId}-winner.png` : null;
    await writeFile(this.absolutePath(refereePath), prepared.referee.image, { flag: 'wx' });
    if (winnerPath && prepared.winner) {
      await writeFile(this.absolutePath(winnerPath), prepared.winner.image, { flag: 'wx' });
    }
    return { winnerPath, refereePath };
  }

  async discardFiles(signing: ScoreSheetSigning) {
    const paths = [
      signing.files.winnerPath,
      signing.files.refereePath,
      this.sheetImagePath({ id: signing.sheetId, refereeSignaturePath: signing.files.refereePath }),
    ];
    for (const path of paths) {
      if (!path) continue;
      await rm(this.absolutePath(path), { force: true }).catch(() => undefined);
    }
  }

  // ---------------------------------------------------------------- 落库与作废

  /** 在结束比赛的同一个事务里写比分单记录；同场旧的有效记录一并作废。 */
  async createRecord(
    tx: Prisma.TransactionClient,
    params: {
      signing: ScoreSheetSigning;
      matchId: string;
      snapshot: ScoreSheetSnapshot;
      refereeId: string;
      refereeName: string;
      matchFinishedAt: Date | null;
      signedAt: Date;
      meta?: ScoreSheetRequestMeta;
    },
  ) {
    const { signing, snapshot, signedAt } = params;
    const winner = signing.prepared.winner;
    const winnerSignerName = winner?.signerName ?? null;
    const contentHash = scoreSheetContentHash({
      sheetId: signing.sheetId,
      matchId: params.matchId,
      snapshot,
      winnerSignerName,
      winnerSignatureSha256: winner?.sha256 ?? null,
      refereeSignatureSha256: signing.prepared.referee.sha256,
      signedAt,
    });
    await tx.matchScoreSheet.updateMany({
      where: { matchId: params.matchId, status: ScoreSheetStatus.VALID },
      data: {
        status: ScoreSheetStatus.VOID,
        voidedAt: signedAt,
        voidReason: '本场重新签字，旧记录作废',
        voidedById: params.refereeId,
      },
    });
    await tx.matchScoreSheet.create({
      data: {
        id: signing.sheetId,
        matchId: params.matchId,
        tournamentId: signing.tournamentId,
        endType: snapshot.endType,
        winnerSide: snapshot.winnerSide,
        winnerSignerIndex: winner?.signerIndex ?? null,
        winnerSignerName,
        winnerSignaturePath: signing.files.winnerPath,
        winnerSignatureSha256: winner?.sha256 ?? null,
        refereeId: params.refereeId,
        refereeName: clip(params.refereeName, 100) ?? '—',
        refereeSignaturePath: signing.files.refereePath,
        refereeSignatureSha256: signing.prepared.referee.sha256,
        snapshot: snapshot as unknown as Prisma.InputJsonValue,
        contentHash,
        matchFinishedAt: params.matchFinishedAt,
        clientIp: clip(params.meta?.ip, 64),
        userAgent: clip(params.meta?.userAgent, 255),
        signedAt,
      },
    });
  }

  /** 管理员重开、改分、清空成绩时把这场的有效比分单标为作废（记录保留）。 */
  async voidValidSheets(
    tx: Prisma.TransactionClient,
    where: Prisma.MatchWhereInput,
    reason: string,
    actorId?: string | null,
  ) {
    return tx.matchScoreSheet.updateMany({
      where: { status: ScoreSheetStatus.VALID, match: where },
      data: {
        status: ScoreSheetStatus.VOID,
        voidedAt: new Date(),
        voidReason: reason.slice(0, 191),
        voidedById: actorId ?? null,
      },
    });
  }

  // ---------------------------------------------------------------- 出图

  /** 生成比分单图片并记下指纹。失败只记日志：下载时会再生成一次。 */
  async renderAndStore(sheetId: string): Promise<boolean> {
    try {
      const row = await this.prisma.matchScoreSheet.findUnique({ where: { id: sheetId } });
      if (!row) return false;
      const [winner, referee] = await Promise.all([
        row.winnerSignaturePath ? readFile(this.absolutePath(row.winnerSignaturePath)) : Promise.resolve(null),
        readFile(this.absolutePath(row.refereeSignaturePath)),
      ]);
      const image = await renderScoreSheetPng({
        sheetId: row.id,
        snapshot: row.snapshot as unknown as ScoreSheetSnapshot,
        signedAt: row.signedAt,
        contentHash: row.contentHash,
        winnerSignerName: row.winnerSignerName,
        winnerSignature: winner,
        refereeSignature: referee,
      });
      const sheetPath = this.sheetImagePath(row);
      await writeFile(this.absolutePath(sheetPath), image);
      await this.prisma.matchScoreSheet.update({
        where: { id: row.id },
        data: { sheetPath, sheetSha256: sha256Hex(image) },
      });
      return true;
    } catch (error) {
      this.logger.error(`比分单 ${sheetId} 生成失败：${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  // ---------------------------------------------------------------- 后台查看

  private effectiveStatus(row: SheetWithMatch): ScoreSheetEffectiveStatus {
    if (row.status === ScoreSheetStatus.VOID) return 'VOID';
    const ended = row.match.status === MatchStatus.COMPLETED || row.match.status === MatchStatus.CANCELLED;
    const sameFinish = (row.match.finishedAt?.getTime() ?? null) === (row.matchFinishedAt?.getTime() ?? null);
    return ended && sameFinish ? 'VALID' : 'STALE';
  }

  private summary(row: SheetWithMatch) {
    const snapshot = row.snapshot as unknown as Partial<ScoreSheetSnapshot> | null;
    const games = snapshot && Array.isArray(snapshot.games) ? snapshot.games : [];
    const winnerSide = row.winnerSide === 1 || row.winnerSide === 2 ? row.winnerSide : null;
    return {
      id: row.id,
      matchId: row.matchId,
      signedAt: row.signedAt,
      endType: row.endType,
      endTypeLabel: SCORE_SHEET_END_TYPE_LABELS[row.endType as ScoreSheetEndType] ?? row.endType,
      status: this.effectiveStatus(row),
      voidedAt: row.voidedAt,
      voidReason: row.voidReason,
      eventLabel: snapshot?.eventLabel ?? '',
      roundLabel: snapshot?.roundLabel ?? '',
      matchLabel: snapshot?.matchLabel ?? snapshot?.roundLabel ?? '',
      matchNo: snapshot?.matchNo ?? null,
      side1Name: snapshot?.side1?.name ?? '待定',
      side2Name: snapshot?.side2?.name ?? '待定',
      scoreText: games.map((game) => `${game.side1Score}:${game.side2Score}`).join(' / '),
      winnerSide,
      winnerName: winnerSide === 1 ? snapshot?.side1?.name ?? null : winnerSide === 2 ? snapshot?.side2?.name ?? null : null,
      winnerSignerName: row.winnerSignerName,
      refereeName: row.refereeName,
      hasSheetImage: Boolean(row.sheetPath),
    };
  }

  async listForTournament(tournamentId: string) {
    const rows = await this.prisma.matchScoreSheet.findMany({
      where: { tournamentId },
      orderBy: { signedAt: 'desc' },
      include: { match: { select: { status: true, finishedAt: true } } },
    });
    return rows.map((row) => this.summary(row));
  }

  /** 单场的全部比分单（含已作废），逐份校验文件和指纹。 */
  async listForMatch(matchId: string) {
    const rows = await this.prisma.matchScoreSheet.findMany({
      where: { matchId },
      orderBy: { signedAt: 'desc' },
      include: { match: { select: { status: true, finishedAt: true } } },
    });
    return Promise.all(rows.map(async (row) => ({
      ...this.summary(row),
      contentHash: row.contentHash,
      refereeId: row.refereeId,
      clientIp: row.clientIp,
      userAgent: row.userAgent,
      integrity: await this.verify(row),
    })));
  }

  private async verify(row: MatchScoreSheet) {
    const problems: string[] = [];
    const check = async (path: string | null, expected: string | null, label: string) => {
      if (!path || !expected) return;
      try {
        const content = await readFile(this.absolutePath(path));
        if (sha256Hex(content) !== expected) problems.push(`${label}和记录的指纹不一致`);
      } catch {
        problems.push(`${label}文件缺失`);
      }
    };
    await check(row.winnerSignaturePath, row.winnerSignatureSha256, '胜方签名图片');
    await check(row.refereeSignaturePath, row.refereeSignatureSha256, '裁判签名图片');
    await check(row.sheetPath, row.sheetSha256, '比分单图片');
    const expected = scoreSheetContentHash({
      sheetId: row.id,
      matchId: row.matchId,
      snapshot: row.snapshot,
      winnerSignerName: row.winnerSignerName,
      winnerSignatureSha256: row.winnerSignatureSha256,
      refereeSignatureSha256: row.refereeSignatureSha256,
      signedAt: row.signedAt,
    });
    if (expected !== row.contentHash) problems.push('比分数据和记录的指纹不一致');
    return { ok: problems.length === 0, problems };
  }

  /** 后台下载比分单或签名图片。比分单图片缺失时现场重新生成。 */
  async resolveFile(matchId: string, sheetId: string, kind: ScoreSheetFileKind) {
    if (!SAFE_ID.test(sheetId)) throw new NotFoundException('比分单不存在');
    let row = await this.prisma.matchScoreSheet.findFirst({ where: { id: sheetId, matchId } });
    if (!row) throw new NotFoundException('比分单不存在');
    if (kind === 'sheet') {
      if (!row.sheetPath || !existsSync(this.absolutePath(row.sheetPath))) {
        await this.renderAndStore(row.id);
        row = await this.prisma.matchScoreSheet.findFirst({ where: { id: sheetId, matchId } });
      }
      if (!row?.sheetPath || !existsSync(this.absolutePath(row.sheetPath))) {
        throw new NotFoundException('比分单图片生成失败，请稍后再试');
      }
      return { path: this.absolutePath(row.sheetPath), filename: `比分单-${row.id}.png` };
    }
    const path = kind === 'winner' ? row.winnerSignaturePath : row.refereeSignaturePath;
    if (!path || !existsSync(this.absolutePath(path))) throw new NotFoundException('签名图片不存在');
    return {
      path: this.absolutePath(path),
      filename: `${kind === 'winner' ? '胜方签名' : '裁判签名'}-${row.id}.png`,
    };
  }

  /** 删除赛事时一并删掉该赛事的签名和比分单文件。 */
  async removeTournamentFiles(tournamentId: string) {
    if (!SAFE_ID.test(tournamentId)) return;
    await rm(this.absolutePath(`${SIGNATURE_DIR}/${tournamentId}`), { recursive: true, force: true })
      .catch((error: unknown) => {
        this.logger.warn(`删除赛事 ${tournamentId} 的签名文件失败：${error instanceof Error ? error.message : String(error)}`);
      });
  }
}
