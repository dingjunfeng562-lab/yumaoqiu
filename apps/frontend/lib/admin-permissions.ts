export const DEFAULT_PERMISSIONS: Record<string, string[]> = {
  ADMIN: ['TOURNAMENTS', 'PLAYERS', 'ORDERBOOK', 'DATA_EXPORT', 'EVENTS', 'TEAMS', 'DRAWS', 'SCHEDULING', 'SCORING', 'PHOTOS', 'USERS', 'DASHBOARD', 'REGISTRATION', 'REFEREE', 'PHOTO_UPLOAD'],
  PLAYER: ['REGISTRATION'], REFEREE: ['REFEREE'], PHOTOGRAPHER: ['PHOTO_UPLOAD'],
};
export function hasFeature(role: string | undefined, permissions: string[] | undefined, key: string) {
  if (key === 'INVITES') return role === 'ADMIN' || role === 'ROOT';
  return role === 'ROOT' || (permissions ?? DEFAULT_PERMISSIONS[role ?? ''] ?? []).includes(key);
}
export function canAccessAdminPage(role: string | undefined, pathname: string, permissions?: string[]) {
  if (role === 'ROOT') return true;
  // 直播管理、裁判员对局管理仅超级管理员可见，没有可分配的功能权限键。
  if (pathname === '/nicaiyixiahh/broadcasts') return false;
  if (pathname.startsWith('/nicaiyixiahh/match-management')) return false;
  if (/^\/nicaiyixiahh\/team-competitions\/[^/]+$/.test(pathname)) {
    return hasFeature(role, permissions, 'TEAMS');
  }
  const routes: Record<string, string[]> = {
    '/nicaiyixiahh': ['DASHBOARD'], '/nicaiyixiahh/tournaments': ['TOURNAMENTS', 'TOURNAMENT_ADMIN'],
    '/nicaiyixiahh/players': ['PLAYERS'], '/nicaiyixiahh/users': ['USERS'], '/nicaiyixiahh/invite-codes': ['INVITES'], '/nicaiyixiahh/photo-activities': ['PHOTOS'],
    '/nicaiyixiahh/exports': ['ORDERBOOK', 'DATA_EXPORT'], '/nicaiyixiahh/competitions': ['TOURNAMENTS', 'TOURNAMENT_ADMIN', 'PLAYERS', 'PHOTOS'],
    '/nicaiyixiahh/events': ['EVENTS'], '/nicaiyixiahh/team-competitions': ['TEAMS'], '/nicaiyixiahh/draws': ['DRAWS'],
    '/nicaiyixiahh/scheduling': ['SCHEDULING'], '/nicaiyixiahh/scoring': ['SCORING'], '/nicaiyixiahh/approvals': ['TOURNAMENT_ADMIN'],
    '/nicaiyixiahh/announcements': ['ANNOUNCEMENTS'], '/nicaiyixiahh/ai-config': ['AI_CONFIG'],
    '/nicaiyixiahh/image-moderation': ['IMAGE_MODERATION'], '/nicaiyixiahh/email': ['EMAIL'],
  };
  const child = /^\/nicaiyixiahh\/competitions\/[^/]+\/(players|registrations|watermark|photos)$/.exec(pathname);
  const activityChild = /^\/nicaiyixiahh\/photo-activities\/[^/]+\/(watermark|photos)$/.test(pathname);
  const keys = activityChild ? ['PHOTOS'] : child ? (['players', 'registrations'].includes(child[1]) ? ['PLAYERS'] : ['PHOTOS']) : routes[pathname];
  return !!keys?.some((key) => hasFeature(role, permissions, key));
}
export function firstAdminPage(role: string | undefined, permissions?: string[]) {
  return ['/nicaiyixiahh', '/nicaiyixiahh/tournaments', '/nicaiyixiahh/competitions', '/nicaiyixiahh/photo-activities', '/nicaiyixiahh/players', '/nicaiyixiahh/exports', '/nicaiyixiahh/users', '/nicaiyixiahh/invite-codes', '/nicaiyixiahh/events', '/nicaiyixiahh/team-competitions', '/nicaiyixiahh/draws', '/nicaiyixiahh/scheduling', '/nicaiyixiahh/scoring', '/nicaiyixiahh/approvals', '/nicaiyixiahh/announcements', '/nicaiyixiahh/ai-config', '/nicaiyixiahh/image-moderation', '/nicaiyixiahh/email'].find((path) => canAccessAdminPage(role, path, permissions));
}
