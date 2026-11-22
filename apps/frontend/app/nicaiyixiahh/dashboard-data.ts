export type DashboardTournament = {
  id: string;
  name: string;
  location?: string | null;
  status: string;
  startDate: string;
  endDate: string;
  registrationEndDate?: string | null;
  isPublished: boolean;
  isArchived: boolean;
  approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
  _count?: { events: number };
  teamCompetitions?: Array<{ id: string }>;
};

export type DashboardPhotoStat = {
  id: string;
  name: string;
  photoCount: number;
  viewCount: number;
  downloadCount: number;
};

export type EventRange = 'today' | 'upcoming';
export type PhotoMetric = 'photoCount' | 'viewCount' | 'downloadCount';

const timeZone = 'Asia/Shanghai';
const day = 24 * 60 * 60 * 1000;
const calendarDate = new Intl.DateTimeFormat('sv-SE', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
const shortDate = new Intl.DateTimeFormat('zh-CN', { timeZone, month: 'long', day: 'numeric' });
const deadlineTime = new Intl.DateTimeFormat('zh-CN', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const dashboardDate = new Intl.DateTimeFormat('zh-CN', { timeZone, month: 'long', day: 'numeric', weekday: 'long' });

export function formatDashboardDate(now: Date) {
  return dashboardDate.format(now);
}

function localDay(timestamp: number) {
  return Date.parse(`${calendarDate.format(timestamp)}T00:00:00+08:00`);
}

type DashboardEvent = {
  key: string;
  tournament: DashboardTournament;
  label: string;
  timing: string;
  tone: 'blue' | 'green' | 'amber' | 'muted';
  time: number;
};

export function dashboardEvents(tournaments: DashboardTournament[], range: EventRange, now: Date) {
  const timestamp = now.getTime();
  const today = localDay(timestamp);
  const tomorrow = today + day;
  const from = range === 'today' ? today : tomorrow;
  const to = range === 'today' ? tomorrow : today + 8 * day;
  const events: DashboardEvent[] = [];

  for (const tournament of tournaments) {
    if (tournament.isArchived || !tournament.isPublished || tournament.approvalStatus !== 'APPROVED' || tournament.status === 'FINISHED') continue;
    const start = Date.parse(tournament.startDate);
    const end = Date.parse(tournament.endDate);
    if (Number.isFinite(start)) {
      const startDay = localDay(start);
      if (startDay >= from && startDay < to) {
        events.push({
          key: `${tournament.id}:start`, tournament, time: startDay,
          label: range === 'today' ? '今日开赛' : '即将开赛', timing: shortDate.format(start), tone: 'blue',
        });
      } else if (range === 'today' && startDay < today && Number.isFinite(end) && localDay(end) >= today) {
        events.push({
          key: `${tournament.id}:ongoing`, tournament, time: today,
          label: '进行中', timing: `${shortDate.format(start)}–${shortDate.format(end)}`, tone: 'green',
        });
      }
    }

    const deadline = Date.parse(tournament.registrationEndDate ?? '');
    if (deadline >= from && deadline < to) {
      const closed = deadline < timestamp;
      events.push({
        key: `${tournament.id}:deadline`, tournament, time: deadline,
        label: closed ? '报名已截止' : '报名截止',
        timing: `${range === 'today' ? '' : shortDate.format(deadline) + ' '}${deadlineTime.format(deadline)}`,
        tone: closed ? 'muted' : 'amber',
      });
    }
  }

  return events.sort((a, b) => Number(a.tone === 'muted') - Number(b.tone === 'muted')
    || a.time - b.time || a.tournament.name.localeCompare(b.tournament.name, 'zh-CN'));
}
