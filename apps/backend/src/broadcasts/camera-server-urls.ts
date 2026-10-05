import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os';

/**
 * Addresses a phone on the venue network can use to reach this server.
 *
 * The pairing QR code carries one of these. The admin page itself usually talks
 * to `localhost`, which on the phone would mean the phone - so the address must
 * come from here, not from the browser.
 *
 * Order: an explicitly configured public address first (production, behind a
 * domain/HTTPS), then this machine's private LAN IPv4 addresses (on-site setup).
 */
export function cameraServerUrls(
  env: { CAMERA_PUBLIC_URL?: string; PORT?: string } = process.env,
  interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces(),
): string[] {
  const urls: string[] = [];

  const configured = env.CAMERA_PUBLIC_URL?.trim().replace(/\/+$/, '').replace(/\/api$/, '');
  if (configured && /^https?:\/\//i.test(configured)) urls.push(configured);

  const port = Number(env.PORT) || 4000;
  const lan: string[] = [];
  for (const [name, entries] of Object.entries(interfaces)) {
    if (!entries || isVirtualAdapter(name)) continue;
    for (const entry of entries) {
      if (entry.family !== 'IPv4' || entry.internal) continue;
      if (!isPrivateIPv4(entry.address)) continue;
      lan.push(`http://${entry.address}:${port}`);
    }
  }
  // Typical venue Wi-Fi (192.168.x) first; 10.x / 172.16-31.x after.
  lan.sort((a, b) => rank(a) - rank(b));

  for (const url of lan) if (!urls.includes(url)) urls.push(url);
  return urls;
}

function isPrivateIPv4(address: string): boolean {
  const [a, b] = address.split('.').map(Number);
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

/** Adapters that are never reachable from a phone on the venue Wi-Fi. */
function isVirtualAdapter(name: string): boolean {
  return /vmware|virtualbox|vbox|hyper-v|vethernet|wsl|docker|loopback|tailscale|zerotier|utun|tun\d|tap\d/i.test(name);
}

function rank(url: string): number {
  if (url.includes('//192.168.')) return 0;
  if (url.includes('//10.')) return 1;
  return 2;
}
