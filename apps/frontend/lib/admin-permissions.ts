export const DEFAULT_PERMISSIONS: Record<string, string[]> = {
  ADMIN: ['TOURNAMENTS', 'PLAYERS', 'PAYMENTS', 'ORDERBOOK', 'DATA_EXPORT', 'EVENTS', 'TEAMS', 'DRAWS', 'SCHEDULING', 'SCORING', 'MATCH_MANAGEMENT', 'USERS', 'DASHBOARD', 'REGISTRATION', 'REFEREE', 'PHOTO_UPLOAD'],
  PLAYER: ['REGISTRATION'], REFEREE: ['REFEREE'], PHOTOGRAPHER: ['PHOTO_UPLOAD'],
};
export function hasFeature(role: string | undefined, permissions: string[] | undefined, key: string) {
  if (key === 'INVITES') return role === 'ADMIN' || role === 'ROOT';
  return role === 'ROOT' || (permissions ?? DEFAULT_PERMISSIONS[role ?? ''] ?? []).includes(key);
}
export function canAccessAdminPage(role: string | undefined, pathname: string, permissions?: string[]) {
  if (role === 'ROOT') return true;
  if (pathname === '/nicaiyixiahh/court-schedule') pathname = '/nicaiyixiahh/scheduling';
  if (pathname === '/nicaiyixiahh/scheduling' && role !== 'ADMIN') return false;
  // 管理员从活动图片入口查看开通状态或申请。图片管理子页仍要求权限。
  if (pathname === '/nicaiyixiahh/photo-activities') return role === 'ADMIN';
  // 直播管理仅超级管理员可见，没有可分配的功能权限键。
  if (pathname === '/nicaiyixiahh/broadcasts') return false;
  // 全服维护开关仅超级管理员可见。
  if (pathname === '/nicaiyixiahh/maintenance') return false;
  if (/^\/nicaiyixiahh\/team-competitions\/[^/]+$/.test(pathname)) {
    return hasFeature(role, permissions, 'TEAMS');
  }
  const routes: Record<string, string[]> = {
    '/nicaiyixiahh/check-in': ['SCHEDULING', 'SCORING'],
    '/nicaiyixiahh': ['DASHBOARD'], '/nicaiyixiahh/statistics': ['DASHBOARD'], '/nicaiyixiahh/tournaments': ['TOURNAMENTS', 'TOURNAMENT_ADMIN'],
    '/nicaiyixiahh/players': ['PLAYERS'], '/nicaiyixiahh/payments': ['PAYMENTS'], '/nicaiyixiahh/users': ['USERS'], '/nicaiyixiahh/invite-codes': ['INVITES'],
    '/nicaiyixiahh/exports': ['ORDERBOOK', 'DATA_EXPORT'], '/nicaiyixiahh/competitions': ['TOURNAMENTS', 'TOURNAMENT_ADMIN', 'PLAYERS', 'PHOTOS'],
    '/nicaiyixiahh/events': ['EVENTS'], '/nicaiyixiahh/team-competitions': ['TEAMS'], '/nicaiyixiahh/draws': ['DRAWS'],
    '/nicaiyixiahh/scheduling': ['SCHEDULING'], '/nicaiyixiahh/scoring': ['SCORING'],
    // 裁判员对局管理：管理员默认有「对局管理」权限，只能管自己的赛事。
    '/nicaiyixiahh/match-management': ['MATCH_MANAGEMENT'], '/nicaiyixiahh/approvals': ['TOURNAMENT_ADMIN'],
    '/nicaiyixiahh/announcements': ['ANNOUNCEMENTS'], '/nicaiyixiahh/ai-config': ['AI_CONFIG'],
    '/nicaiyixiahh/image-moderation': ['IMAGE_MODERATION'], '/nicaiyixiahh/email': ['EMAIL'],
  };
  const child = /^\/nicaiyixiahh\/competitions\/[^/]+\/(players|registrations|watermark|photos)$/.exec(pathname);
  const activityChild = /^\/nicaiyixiahh\/photo-activities\/[^/]+\/(watermark|photos)$/.test(pathname);
  if (activityChild || (child && ['watermark', 'photos'].includes(child[1]))) return role === 'ADMIN';
  const keys = child ? ['PLAYERS'] : routes[pathname];
  return !!keys?.some((key) => hasFeature(role, permissions, key));
}
export function firstAdminPage(role: string | undefined, permissions?: string[]) {
  return ['/nicaiyixiahh', '/nicaiyixiahh/tournaments', '/nicaiyixiahh/competitions', '/nicaiyixiahh/photo-activities', '/nicaiyixiahh/players', '/nicaiyixiahh/payments', '/nicaiyixiahh/exports', '/nicaiyixiahh/users', '/nicaiyixiahh/invite-codes', '/nicaiyixiahh/events', '/nicaiyixiahh/team-competitions', '/nicaiyixiahh/draws', '/nicaiyixiahh/scheduling', '/nicaiyixiahh/scoring', '/nicaiyixiahh/approvals', '/nicaiyixiahh/announcements', '/nicaiyixiahh/ai-config', '/nicaiyixiahh/image-moderation', '/nicaiyixiahh/email'].find((path) => canAccessAdminPage(role, path, permissions));
}
