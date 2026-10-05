import { Injectable, CanActivate, ExecutionContext, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthActor } from './admin-scope';
import { hasPermission, requiredPermissions } from './permissions';

export const ROLES_KEY = 'roles';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector, private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const user = req.user as AuthActor | undefined;
    if (!user) return false;
    if (user.role === Role.ROOT) return true;
    const controller = context.getClass().name;
    const action = context.getHandler().name;
    const params = req.params ?? {};
    const features = requiredPermissions(controller, action, params.kind);
    if (features) {
      if (!features.length || !hasPermission(user, ...features)) return false;
    } else {
      const roles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [context.getHandler(), context.getClass()]);
      if (roles && !roles.includes(user.role)) return false;
    }
    // Native workflows retain public access and their own referee grants.
    if (['AuthController', 'PhotosController', 'CompetitionsController'].includes(controller)) return true;
    if (controller === 'ScoringController' && ((features?.length === 1 && features[0] === 'REFEREE') || !hasPermission(user, 'SCORING'))) return true;
    if (controller === 'DrawsController' && !hasPermission(user, 'DRAWS')) {
      const event = await this.prisma.event.findUnique({ where: { id: params.eventId }, select: { tournamentId: true } });
      const grant = event && await this.prisma.refereeTournamentGrant.findUnique({ where: { tournamentId_userId: { tournamentId: event.tournamentId, userId: user.id } } });
      if (!grant) throw new ForbiddenException('尚未获得该赛事的裁判授权');
      return true;
    }
    const tournament = async (id: unknown) => {
      const found = typeof id === 'string' && await this.prisma.tournament.findFirst({ where: { id, submittedById: user.id }, select: { id: true } });
      if (!found) throw new NotFoundException('赛事不存在或不属于你');
    };
    const event = async (id: string) => {
      const item = await this.prisma.event.findUnique({ where: { id }, select: { tournamentId: true } });
      await tournament(item?.tournamentId);
    };
    const match = async (id: string) => {
      const item = await this.prisma.match.findUnique({ where: { id }, include: { event: true, teamMatch: { include: { teamCompetition: true } } } });
      await tournament(item?.event?.tournamentId ?? item?.teamMatch?.teamCompetition.tournamentId);
    };
    const venue = async (id: string) => {
      const item = await this.prisma.venue.findUnique({ where: { id }, select: { tournamentId: true } });
      await tournament(item?.tournamentId);
    };
    const team = async (id: string) => {
      const item = await this.prisma.team.findUnique({ where: { id }, include: { teamCompetition: true } });
      await tournament(item?.teamCompetition.tournamentId);
    };
    const registration = async (id: string) => {
      const item = await this.prisma.registration.findUnique({ where: { id }, include: { event: true } });
      await tournament(item?.event.tournamentId);
    };
    const photo = async (id: string) => {
      const item = await this.prisma.photo.findUnique({ where: { id }, select: { tournamentId: true, activityId: true } });
      if (item?.activityId) {
        const activity = await this.prisma.photoActivity.findFirst({
          where: { id: item.activityId, submittedById: user.id }, select: { id: true },
        });
        if (!activity) throw new NotFoundException('活动图片不存在或不属于你');
        return;
      }
      await tournament(item?.tournamentId);
    };
    const player = async (id: string) => {
      const item = await this.prisma.player.findFirst({ where: { id, ownerId: user.id }, select: { id: true } });
      if (!item) throw new NotFoundException('选手不存在或不属于你');
    };
    if (params.tournamentId) await tournament(params.tournamentId);
    if (params.competitionId) await tournament(params.competitionId);
    if (params.eventId) await (controller === 'AdminEmailController' ? tournament : event)(params.eventId);
    if (params.matchId) await match(params.matchId);
    if (params.teamId) await team(params.teamId);
    if (params.teamMatchId) {
      const item = await this.prisma.teamMatch.findUnique({ where: { id: params.teamMatchId }, include: { teamCompetition: true } });
      await tournament(item?.teamCompetition.tournamentId);
    }
    if (params.registrationId) {
      if (params.competitionId) await registration(params.registrationId);
      else {
        const item = await this.prisma.competitionRegistration.findUnique({ where: { id: params.registrationId }, select: { competitionId: true } });
        await tournament(item?.competitionId);
      }
    }
    if (params.id) {
      if (['TournamentsController', 'AdminCompetitionsController', 'ExportsController'].includes(controller)) await tournament(params.id);
      if (controller === 'PlayersController') await player(params.id);
      if (controller === 'EventsController') await event(params.id);
      if (controller === 'ScoringController') await match(params.id);
      if (controller === 'SchedulingController') await (action === 'updateMatchSchedule' ? match : venue)(params.id);
      if (controller === 'TeamCompetitionsController') {
        const item = await this.prisma.teamCompetition.findUnique({ where: { id: params.id }, select: { tournamentId: true } });
        await tournament(item?.tournamentId);
      }
      if (controller === 'AdminPhotosController') await (String(req.route.path).includes('tournaments/') ? tournament : photo)(params.id);
      if (controller === 'DrawsController') {
        if (String(req.route.path).includes('redraw-requests')) {
          const item = await this.prisma.drawRedrawRequest.findUnique({ where: { id: params.id }, select: { eventItemId: true } });
          if (!item) throw new NotFoundException('重抽申请不存在');
          await event(item.eventItemId);
        } else await registration(params.id);
      }
    }
    // Validate foreign keys even in bulk payloads before any mutation.
    const inspect = async (value: unknown): Promise<void> => {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) { for (const item of value) await inspect(item); return; }
      for (const [key, id] of Object.entries(value)) {
        if (typeof id === 'string' && id) {
          if (key === 'tournamentId' || key === 'competitionId') await tournament(id);
          if (key === 'eventId') await (controller === 'AdminEmailController' ? tournament : event)(id);
          if (key === 'venueId') await venue(id);
          if (key === 'matchId') await match(id);
          if (key === 'teamId') await team(id);
          if (key === 'registrationId') await registration(id);
          if (['playerId', 'player1Id', 'player2Id'].includes(key)) await player(id);
          if (key === 'refereeId') {
            const referee = await this.prisma.user.findFirst({ where: { id, managerId: user.id }, select: { id: true } });
            if (!referee) throw new NotFoundException('裁判不属于你管理的账号');
          }
        } else if (typeof id === 'object') await inspect(id);
      }
    };
    await inspect(req.query);
    await inspect(req.body);
    if (controller === 'AdminPhotosController' && action === 'deletePhotos' && Array.isArray(req.body?.ids)) {
      for (const id of req.body.ids) await photo(id);
    }
    return true;
  }
}
