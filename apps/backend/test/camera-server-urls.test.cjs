// Unit checks for the pairing-address helper (no server or database needed).
//   node test/camera-server-urls.test.cjs   (after `pnpm build`, or via ts-node)
const assert = require('node:assert/strict');
const path = require('node:path');

require('ts-node').register({
  transpileOnly: true,
  compilerOptions: { module: 'commonjs' },
});
const { cameraServerUrls } = require(path.join(__dirname, '../src/broadcasts/camera-server-urls.ts'));

const v4 = (address, internal = false) => ({ address, family: 'IPv4', internal, netmask: '', mac: '', cidr: null });
const v6 = (address) => ({ address, family: 'IPv6', internal: false, netmask: '', mac: '', cidr: null, scopeid: 0 });

// Typical Windows laptop at a venue: Wi-Fi, a VM switch, WSL, loopback.
const laptop = {
  'WLAN': [v6('fe80::1'), v4('192.168.31.57')],
  'vEthernet (WSL)': [v4('172.24.80.1')],
  'VMware Network Adapter VMnet8': [v4('192.168.75.1')],
  'Loopback Pseudo-Interface 1': [v4('127.0.0.1', true)],
  '以太网': [v4('10.20.0.8')],
};

{
  const urls = cameraServerUrls({ PORT: '4000' }, laptop);
  assert.deepEqual(urls, ['http://192.168.31.57:4000', 'http://10.20.0.8:4000'],
    'Wi-Fi first, virtual adapters and loopback excluded');
}

{
  const urls = cameraServerUrls({ PORT: '4100', CAMERA_PUBLIC_URL: 'https://live.example.com/api/' }, laptop);
  assert.equal(urls[0], 'https://live.example.com', 'configured public URL wins and loses /api');
  assert.ok(urls.includes('http://192.168.31.57:4100'), 'LAN fallback uses the real port');
}

{
  const urls = cameraServerUrls({ CAMERA_PUBLIC_URL: 'not-a-url' }, { eth0: [v4('8.8.8.8')] });
  assert.deepEqual(urls, [], 'junk config ignored; public IPs are not guessed as LAN');
}

{
  assert.deepEqual(cameraServerUrls({}, {}), [], 'no interfaces, no suggestions');
  const urls = cameraServerUrls({}, { eth0: [v4('172.16.4.2'), v4('172.32.0.1')] });
  assert.deepEqual(urls, ['http://172.16.4.2:4000'], '172.16/12 is private, 172.32 is not; default port 4000');
}

console.log('camera-server-urls: OK');
