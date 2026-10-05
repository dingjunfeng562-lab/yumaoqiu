// Creates a separate local test room; leaves any existing live session running.
const { PrismaClient } = require('@prisma/client');
const { PrismaMariaDb } = require('@prisma/adapter-mariadb');
const { JwtService } = require('@nestjs/jwt');
if (!['localhost', '127.0.0.1'].includes(new URL(process.env.DATABASE_URL).hostname)) throw new Error('Local database required');
const db = new PrismaClient({ adapter: new PrismaMariaDb(process.env.DATABASE_URL) });
async function main() {
  const source = await db.broadcastSession.findFirst({ where: { liveRoomName: null }, orderBy: { updatedAt: 'desc' } });
  if (!source) throw new Error('Create a broadcast for the test tournament first');
  const actor = source.createdById && await db.user.findFirst({ where: { id: source.createdById, role: 'ROOT' }, select: { id: true } })
    || await db.user.findFirst({ where: { role: 'ROOT' }, select: { id: true } });
  if (!actor) throw new Error('ROOT account required');
  const token = new JwtService().sign({ sub: actor.id }, { secret: process.env.JWT_SECRET, expiresIn: '2m' });
  const request = async (endpoint, body) => {
    const response = await fetch(`http://127.0.0.1:4000/api${endpoint}`, {
      method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || `HTTP ${response.status}`);
    return result;
  };
  const status = await request(`/broadcasts/${source.id}/live`);
  if (!status.configured) throw new Error('Restart the backend after configuring local LiveKit');
  const title = `${source.title} · 多机位测试`;
  let room = await db.broadcastSession.findFirst({ where: { tournamentId: source.tournamentId, title, status: { not: 'ENDED' } } });
  if (!room) room = await request('/broadcasts', { title, tournamentId: source.tournamentId,
    ...(source.venueId ? { venueId: source.venueId } : {}), ...(source.currentMatchId ? { currentMatchId: source.currentMatchId } : {}) });
  await request(`/broadcasts/${room.id}/live/enable`, { cameraCount: 4 });
  console.log(`Director: http://localhost:3000/director/${room.id}`);
  console.log(`Title: ${title}; 4 cameras; generate the shared QR in the director page.`);
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(() => db.$disconnect());
