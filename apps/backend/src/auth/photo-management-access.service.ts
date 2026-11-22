import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PhotoManagementRequestStatus, PhotoManagementTargetType, Prisma, Role, UserStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type RequestActor = { id: string; username: string; role: Role };
export type PhotoManagementDecision = 'approve' | 'reject' | 'revoke';
export type PhotoManagementTarget = { targetType: PhotoManagementTargetType; targetId: string };

const eligibleApplicant = { role: Role.ADMIN, status: UserStatus.ACTIVE };

@Injectable()
export class PhotoManagementAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async listMine(actor: RequestActor) {
    this.assertAdmin(actor);
    const rows = await this.prisma.photoManagementRequest.findMany({
      where: { applicantId: actor.id },
      orderBy: [{ active: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true, targetType: true, targetId: true, status: true, purpose: true, createdAt: true,
        reviewedAt: true, reviewReason: true, revokedAt: true, revokeReason: true,
      },
    });
    return [...new Map(rows.reverse().map((row) => [`${row.targetType}:${row.targetId}`, row])).values()];
  }

  async submit(actor: RequestActor, target: PhotoManagementTarget, purpose: string) {
    this.assertAdmin(actor);
    const resource = await this.findTarget(target);
    if (resource?.submittedById !== actor.id) throw new NotFoundException('赛事或活动不存在或不属于你');
    try {
      return await this.prisma.photoManagementRequest.create({
        data: {
          ...target,
          targetName: resource.name,
          applicantId: actor.id,
          applicantName: actor.username,
          purpose,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('该赛事或活动已有待审核申请或已开通图片管理');
      }
      throw error;
    }
  }

  listRequests() {
    return this.prisma.photoManagementRequest.findMany({
      include: { applicant: { select: { id: true, username: true, role: true, status: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  async decide(id: string, decision: PhotoManagementDecision, reason: string | undefined, reviewer: RequestActor) {
    if (reviewer.role !== Role.ROOT) throw new ForbiddenException('仅超级管理员可以处理图片管理权限');
    const note = reason?.trim();
    if (decision !== 'approve' && !note) throw new BadRequestException('请填写处理原因');

    const now = new Date();
    const where: Prisma.PhotoManagementRequestWhereUniqueInput = {
      id,
      active: true,
      status: decision === 'revoke' ? PhotoManagementRequestStatus.APPROVED : PhotoManagementRequestStatus.PENDING,
      ...(decision === 'approve' ? { applicant: { is: eligibleApplicant } } : {}),
    };
    if (decision === 'approve') {
      const request = await this.prisma.photoManagementRequest.findUnique({
        where, select: { applicantId: true, targetType: true, targetId: true },
      });
      const target = request ? await this.findTarget(request) : null;
      if (!request || !target || target.submittedById !== request.applicantId) {
        throw new ConflictException('申请状态、账号资格或赛事归属已变更，请刷新后重试');
      }
    }
    const data: Prisma.PhotoManagementRequestUpdateInput = decision === 'revoke'
      ? {
          status: PhotoManagementRequestStatus.REVOKED, active: null,
          revokedAt: now, revokedById: reviewer.id, revokedByName: reviewer.username, revokeReason: note,
        }
      : {
          status: decision === 'approve' ? PhotoManagementRequestStatus.APPROVED : PhotoManagementRequestStatus.REJECTED,
          active: decision === 'approve' ? true : null,
          reviewedAt: now, reviewedById: reviewer.id, reviewedByName: reviewer.username, reviewReason: note || null,
        };

    try {
      return await this.prisma.photoManagementRequest.update({ where, data });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new ConflictException('申请状态或账号资格已变更，请刷新后重试');
      }
      throw error;
    }
  }

  private assertAdmin(actor: RequestActor) {
    if (actor.role !== Role.ADMIN) throw new ForbiddenException('仅管理员账号可以申请图片管理');
  }

  private async findTarget(target: PhotoManagementTarget) {
    if (target.targetType === PhotoManagementTargetType.TOURNAMENT) {
      return this.prisma.tournament.findUnique({
        where: { id: target.targetId }, select: { name: true, submittedById: true },
      });
    }
    const activity = await this.prisma.photoActivity.findUnique({
      where: { id: target.targetId }, select: { title: true, submittedById: true },
    });
    return activity ? { name: activity.title, submittedById: activity.submittedById } : null;
  }
}
