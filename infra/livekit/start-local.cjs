const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const local = path.join(__dirname, '.local');
const executable = process.env.LIVEKIT_EXECUTABLE || 'D:/AyumaoqiuTools/livekit-1.13.7/livekit-server.exe';
const config = path.join(local, 'livekit.yaml');
if (!fs.existsSync(config)) throw new Error('Run node infra/livekit/configure-local.cjs first.');
if (!fs.existsSync(executable)) throw new Error('Set LIVEKIT_EXECUTABLE to the installed server executable.');
const probe = net.connect(7880, '127.0.0.1');
probe.on('connect', () => { probe.end(); console.log('Port 7880 is already listening; no additional server started.'); });
probe.on('error', () => {
  const out = fs.openSync(path.join(local, 'livekit.out.log'), 'a');
  const err = fs.openSync(path.join(local, 'livekit.err.log'), 'a');
  const child = spawn(executable, ['--config', config], { windowsHide: true, detached: true, stdio: ['ignore', out, err] });
  child.on('error', (error) => { console.error('LiveKit failed to start:', error.code); process.exitCode = 1; });
  child.on('spawn', () => {
    fs.writeFileSync(path.join(local, 'livekit.pid'), String(child.pid));
    console.log(`Local LiveKit started (PID ${child.pid}).`);
  });
  child.unref(); fs.closeSync(out); fs.closeSync(err);
});
