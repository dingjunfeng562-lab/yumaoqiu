// Run from an administrator terminal. Rules are limited to this media executable.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const executable = path.resolve(process.env.LIVEKIT_EXECUTABLE || 'D:/AyumaoqiuTools/livekit-1.13.7/livekit-server.exe');
if (!fs.existsSync(executable)) throw new Error('LiveKit executable not found');
const index = process.argv.indexOf('--remote-subnet');
const remote = index < 0 ? 'LocalSubnet' : process.argv[index + 1];
if (remote !== 'LocalSubnet' && !/^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/.test(remote || '')) throw new Error('Use LocalSubnet or a VPN IPv4 CIDR');
const quote = (value) => "'" + value.replace(/'/g, "''") + "'";
const commands = ["$ErrorActionPreference = 'Stop'"];
for (const [protocol, ports] of [['TCP', '7880,7881'], ['UDP', '7882']]) {
  const name = `Ayumaoqiu-LiveKit-${protocol}`;
  commands.push(`if (Get-NetFirewallRule -Name '${name}' -ErrorAction SilentlyContinue) { Set-NetFirewallRule -Name '${name}' -Enabled True -RemoteAddress ${quote(remote)} -Program ${quote(executable)} } else { New-NetFirewallRule -Name '${name}' -DisplayName '${name}' -Direction Inbound -Action Allow -Protocol ${protocol} -LocalPort ${ports} -Program ${quote(executable)} -RemoteAddress ${quote(remote)} -Profile Any | Out-Null }`);
}
commands.push("Write-Output 'LiveKit camera firewall rules ready'");
const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', commands.join('; ')], { stdio: 'inherit', windowsHide: true });
if (result.error) throw result.error;
process.exitCode = result.status || 0;
