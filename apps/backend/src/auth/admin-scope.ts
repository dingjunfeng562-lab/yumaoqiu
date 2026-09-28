import { Prisma, Role } from '@prisma/client';

export type AuthActor = { id: string; role: Role; permissions?: Prisma.JsonValue };
export const MANAGED_ROLES: Role[] = [Role.PLAYER, Role.REFEREE, Role.PHOTOGRAPHER];
export const STAFF_ROLES: Role[] = [Role.REFEREE, Role.PHOTOGRAPHER];

export function tournamentScope(actor?: AuthActor) {
  return actor && actor.role !== Role.ROOT ? { submittedById: actor.id } : {};
}

export function playerScope(actor?: AuthActor) {
  return actor && actor.role !== Role.ROOT ? { ownerId: actor.id } : {};
}

// Every ADMIN operation must be explicitly listed. Lists are filtered in their
// services; individual resources are checked by RolesGuard before dispatch.
export const ADMIN_ACTIONS: Record<string, readonly string[]> = {
  AuthController: [
    'createReferee', 'createPlayer', 'createPhotographer', 'listUsers',
    'resetUserPassword', 'updateUserStatus', 'renameUser', 'deleteUser', 'deleteUsers',
    'listInviteCodes', 'createInviteCode', 'updateInviteCode', 'deleteInviteCode', 'getInviteQuota',
  ],
  TournamentsController: ['uploadCover', 'create', 'findAll', 'findOne', 'update'],
  PlayersController: ['create', 'findAll', 'findOne', 'update', 'remove'],
  AdminCompetitionsController: [
    'listCompetitions', 'listRegistrations', 'listPlayers', 'batchAddPlayers',
    'createPlayer', 'createPlayerFromLibrary', 'updatePlayer', 'removePlayerRegistration',
    'approveRegistration', 'rejectRegistration', 'removeRegistration',
  ],
  EventsController: ['findByTournament', 'findOne'],
  ExportsController: ['download'],
};
