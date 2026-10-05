export const DEFAULT_PERMISSIONS: Record<string, string[]> = {
  ADMIN: ['TOURNAMENTS', 'PLAYERS', 'ORDERBOOK', 'USERS', 'INVITES', 'PHOTOS', 'DASHBOARD'],
  PLAYER: ['REGISTRATION'], REFEREE: ['REFEREE'], PHOTOGRAPHER: ['PHOTO_UPLOAD'],
};
export function hasFeature(role: string | undefined, permissions: string[] | undefined, key: string) {
  if (key === 'INVITES') return role === 'ADMIN' || role === 'ROOT';
  return role === 'ROOT' || (permissions ?? DEFAULT_PERMISSIONS[role ?? ''] ?? []).includes(key);
}
export function canAccessAdminPage(role: string | undefined, pathname: string, permissions?: string[]) {
  if (role === 'ROOT') return true;
  // 直播管理仅超级管理员，没有可分配的功能权限键。
  if (pathname === '/admin/broadcasts') return false;
  const routes: Record<string, string[]> = {
    '/admin': ['DASHBOARD'], '/admin/tournaments': ['TOURNAMENTS', 'TOURNAMENT_ADMIN'],
    '/admin/players': ['PLAYERS'], '/admin/users': ['USERS'], '/admin/invite-codes': ['INVITES'], '/admin/photo-activities': ['PHOTOS'],
    '/admin/exports': ['ORDERBOOK', 'DATA_EXPORT'], '/admin/competitions': ['TOURNAMENTS', 'TOURNAMENT_ADMIN', 'PLAYERS', 'PHOTOS'],
    '/admin/events': ['EVENTS'], '/admin/team-competitions': ['TEAMS'], '/admin/draws': ['DRAWS'],
    '/admin/scheduling': ['SCHEDULING'], '/admin/scoring': ['SCORING'], '/admin/approvals': ['TOURNAMENT_ADMIN'],
    '/admin/announcements': ['ANNOUNCEMENTS'], '/admin/ai-config': ['AI_CONFIG'],
    '/admin/image-moderation': ['IMAGE_MODERATION'], '/admin/email': ['EMAIL'],
  };
  const child = /^\/admin\/competitions\/[^/]+\/(players|registrations|watermark|photos)$/.exec(pathname);
  const activityChild = /^\/admin\/photo-activities\/[^/]+\/(watermark|photos)$/.test(pathname);
  const keys = activityChild ? ['PHOTOS'] : child ? (['players', 'registrations'].includes(child[1]) ? ['PLAYERS'] : ['PHOTOS']) : routes[pathname];
  return !!keys?.some((key) => hasFeature(role, permissions, key));
}
export function firstAdminPage(role: string | undefined, permissions?: string[]) {
  return ['/admin', '/admin/tournaments', '/admin/competitions', '/admin/photo-activities', '/admin/players', '/admin/exports', '/admin/users', '/admin/invite-codes', '/admin/events', '/admin/team-competitions', '/admin/draws', '/admin/scheduling', '/admin/scoring', '/admin/approvals', '/admin/announcements', '/admin/ai-config', '/admin/image-moderation', '/admin/email'].find((path) => canAccessAdminPage(role, path, permissions));
}
