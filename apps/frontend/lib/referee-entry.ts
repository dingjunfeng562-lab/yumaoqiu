export function parseRefereeEntry(value: string, origin: string): string {
  const url = new URL(value.trim(), origin);
  if (url.origin !== origin || !/^\/referee\/authorize\/[a-f0-9]{64}\/?$/.test(url.pathname)) {
    throw new Error('请扫描本站「裁判分配」中的赛事二维码');
  }
  return url.pathname.replace(/\/$/, '');
}
