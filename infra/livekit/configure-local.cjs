// Configures this Windows development machine; production templates stay separate.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomBytes } = require('node:crypto');
const backend = path.resolve(__dirname, '../../apps/backend');
const dotenv = require(path.join(backend, 'node_modules/dotenv'));
const envPath = path.join(backend, '.env');
const original = fs.readFileSync(envPath, 'utf8');
const env = dotenv.parse(original);
const addresses = Object.entries(os.networkInterfaces()).flatMap(([name, values]) =>
  /vmware|virtual|vethernet|docker|wsl|meta|loopback/i.test(name) ? [] : values.filter((v) =>
    v.family === 'IPv4' && !v.internal && /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(v.address)).map((v) => v.address));
const hostArg = process.argv.indexOf('--host');
const host = hostArg >= 0 ? process.argv[hostArg + 1] : addresses.sort((a, b) => Number(!a.startsWith('192.168.')) - Number(!b.startsWith('192.168.')))[0];
if (!host || !/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.split('.').some((n) => +n > 255) || host.startsWith('127.')) {
  throw new Error('Specify this computer LAN or VPN IPv4 using --host');
}
const local = path.join(__dirname, '.local');
fs.mkdirSync(local, { recursive: true });
const backup = path.join(local, 'backend.env.before-local');
if (!fs.existsSync(backup)) fs.writeFileSync(backup, original);
const key = env.LIVEKIT_API_KEY || `local_${randomBytes(12).toString('hex')}`;
const secret = env.LIVEKIT_API_SECRET || randomBytes(32).toString('hex');
const values = { LIVEKIT_URL: `ws://${host}:7880`, LIVEKIT_INTERNAL_URL: 'http://127.0.0.1:7880',
  LIVEKIT_API_KEY: key, LIVEKIT_API_SECRET: secret, CAMERA_PUBLIC_URL: `http://${host}:4000` };
let updated = original;
for (const [name, value] of Object.entries(values)) {
  const line = `${name}=${JSON.stringify(value)}`;
  const pattern = new RegExp(`^${name}=.*$`, 'm');
  updated = pattern.test(updated) ? updated.replace(pattern, line) : `${updated.trimEnd()}\n${line}\n`;
}
fs.writeFileSync(envPath, updated);
fs.writeFileSync(path.join(local, 'livekit.yaml'), [
  'port: 7880', 'bind_addresses: ["0.0.0.0"]', 'rtc:', '  tcp_port: 7881', '  udp_port: 7882',
  `  node_ip: ${JSON.stringify(host)}`, '  use_external_ip: false', 'keys:', `  ${JSON.stringify(key)}: ${JSON.stringify(secret)}`,
  'room:', '  auto_create: true', '  empty_timeout: 300', '  max_participants: 18', 'logging:', '  level: info', '',
].join('\n'));
console.log(`Local camera API: http://${host}:4000`);
console.log(`Local media: ws://${host}:7880 (TCP 7880/7881, UDP 7882)`);
console.log('Backend environment updated; credentials kept in ignored files. Restart the backend to apply.');
