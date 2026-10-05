import { Prisma, Role } from '@prisma/client';

export const PERMISSION_OPTIONS = [
  { key: 'TOURNAMENTS', label: '创建和编辑赛事', group: '赛事' },
  { key: 'TOURNAMENT_ADMIN', label: '赛事审核、发布、归档和排名', group: '赛事' },
  { key: 'PLAYERS', label: '选手管理与报名审核', group: '赛事' },
  { key: 'ORDERBOOK', label: '秩序册导出', group: '赛事' },
  { key: 'DATA_EXPORT', label: '赛程、成绩和报名数据导出', group: '赛事' },
  { key: 'EVENTS', label: '单项管理', group: '赛事' },
  { key: 'TEAMS', label: '团体赛管理', group: '赛事' },
  { key: 'DRAWS', label: '抽签编排与重抽审批', group: '赛事' },
  { key: 'SCHEDULING', label: '场地排程', group: '赛事' },
  { key: 'SCORING', label: '裁判分配与比赛记分管理', group: '赛事' },
  { key: 'PHOTOS', label: '赛事图片、水印和图片二维码', group: '赛事' },
  { key: 'USERS', label: '管理下属账号', group: '账号' },
  { key: 'INVITES', label: '发放和管理邀请码', group: '账号' },
  { key: 'ANNOUNCEMENTS', label: '公告管理', group: '系统' },
  { key: 'AI_CONFIG', label: 'AI 助手配置', group: '系统' },
  { key: 'IMAGE_MODERATION', label: '图片审核配置', group: '系统' },
  { key: 'EMAIL', label: '邮件设置和赛事通知', group: '系统' },
  { key: 'DASHBOARD', label: '仪表盘（本人赛事与图片统计）', group: '系统' },
  { key: 'REGISTRATION', label: '个人赛事报名', group: '个人功能' },
  { key: 'REFEREE', label: '裁判扫码授权与执裁', group: '个人功能' },
  { key: 'PHOTO_UPLOAD', label: '图片员上传', group: '个人功能' },
] as const;
export type PermissionKey = typeof PERMISSION_OPTIONS[number]['key'];
export const PERMISSION_KEYS: string[] = PERMISSION_OPTIONS.map((item) => item.key);
export type PermissionUser = { role: Role; permissions?: Prisma.JsonValue };
export const DEFAULT_PERMISSIONS: Record<Role, PermissionKey[]> = {
  ROOT: PERMISSION_OPTIONS.map((item) => item.key),
  ADMIN: ['TOURNAMENTS', 'PLAYERS', 'ORDERBOOK', 'USERS', 'INVITES', 'DASHBOARD'],
  PLAYER: ['REGISTRATION'],
  REFEREE: ['REFEREE'],
  PHOTOGRAPHER: ['PHOTO_UPLOAD'],
};
export function effectivePermissions(user: PermissionUser): PermissionKey[] {
  if (user.role === Role.ROOT) return [...DEFAULT_PERMISSIONS.ROOT];
  if (!Array.isArray(user.permissions)) return [...DEFAULT_PERMISSIONS[user.role]];
  return user.permissions.filter((value): value is PermissionKey => typeof value === 'string' && PERMISSION_KEYS.includes(value));
}
export function hasPermission(user: PermissionUser, ...keys: PermissionKey[]) {
  return user.role === Role.ROOT || keys.some((key) => effectivePermissions(user).includes(key));
}

// An empty set means ROOT-only. Unknown controllers retain their role guards.
export function requiredPermissions(controller: string, action: string, kind?: string): PermissionKey[] | undefined {
  const tournamentRead: PermissionKey[] = ['TOURNAMENTS', 'TOURNAMENT_ADMIN', 'PLAYERS', 'ORDERBOOK', 'DATA_EXPORT', 'EVENTS', 'TEAMS', 'DRAWS', 'SCHEDULING', 'SCORING', 'PHOTOS', 'EMAIL', 'DASHBOARD'];
  switch (controller) {
    case 'AuthController':
      if (['createRoot', 'createAdmin', 'updateUserRole', 'updateInviteQuota', 'setUserPermissions', 'getUserPermissions', 'permissionOptions'].includes(action)) return [];
      if (action === 'getInviteQuota') return ['USERS', 'INVITES'];
      if (action.toLowerCase().includes('invitecode')) return ['INVITES'];
      return ['USERS'];
    case 'TournamentsController':
      if (['findAll', 'findOne'].includes(action)) return tournamentRead;
      if (['create', 'uploadCover', 'update'].includes(action)) return ['TOURNAMENTS'];
      // 大屏设置属于赛事编辑：能编辑赛事的人就能排布自己的大屏，赛事管理员同样可以调整。
      if (['getScreenSettings', 'updateScreenSettings'].includes(action)) return ['TOURNAMENTS', 'TOURNAMENT_ADMIN'];
      return ['TOURNAMENT_ADMIN'];
    case 'PlayersController': return ['PLAYERS'];
    case 'AdminCompetitionsController':
      if (action === 'listCompetitions') return tournamentRead;
      if (action === 'createPhotoAccess') return ['PHOTOS'];
      if (['publishCompetition', 'unpublishCompetition', 'getRankings', 'updateRankings'].includes(action)) return ['TOURNAMENT_ADMIN'];
      return ['PLAYERS'];
    case 'EventsController': return ['findOne', 'findByTournament'].includes(action) ? tournamentRead : ['EVENTS'];
    case 'ExportsController':
      if (action === 'listFiles') return ['ORDERBOOK', 'DATA_EXPORT'];
      return [action === 'download' && kind === 'orderbook' ? 'ORDERBOOK' : 'DATA_EXPORT'];
    case 'TeamCompetitionsController': return ['TEAMS'];
    case 'DrawsController': return ['getSecondStage', 'confirmSecondStage'].includes(action) ? ['DRAWS', 'REFEREE'] : ['DRAWS'];
    case 'SchedulingController': return ['SCHEDULING'];
    case 'ScoringController':
      if (['authorizeTournament', 'listAuthorizedTournaments', 'listRefereeMatches', 'listTournamentCourts', 'listCourtMatches', 'claimCourtMatch'].includes(action)) return ['REFEREE'];
      if (['listAssignableReferees', 'getRefereeAccessCode', 'correctMatchScore', 'assignReferee'].includes(action)) return ['SCORING'];
      return ['SCORING', 'REFEREE'];
    case 'AdminPhotosController': return action === 'listTournamentStats' ? ['PHOTOS', 'DASHBOARD'] : ['PHOTOS'];
    case 'PhotosController': return ['PHOTO_UPLOAD'];
    case 'AdminAnnouncementsController': return ['ANNOUNCEMENTS'];
    case 'AiConfigController': return ['AI_CONFIG'];
    case 'ImageModerationController': return ['IMAGE_MODERATION'];
    case 'AdminEmailController': return ['EMAIL'];
    // AI chat usage is platform-wide, so only ROOT may see it.
    case 'UsageMetricsController': return [];
    // 直播管理（直播间、OBS 记分牌令牌、播放地址）仅限超级管理员。
    case 'BroadcastsController': return [];
    case 'CompetitionsController': return ['REGISTRATION'];
    default: return undefined;
  }
}
