'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { Alert, Button, Modal } from 'antd';
import {
  CalendarOutlined, CheckCircleOutlined, ClockCircleOutlined, InboxOutlined,
  MessageOutlined, PictureOutlined, PlusOutlined, ReloadOutlined, RightOutlined,
  TrophyOutlined,
} from '@ant-design/icons';
import { apiFetch } from '@/lib/api';
import { canAccessAdminPage } from '@/lib/admin-permissions';
import { PHOTO_MANAGEMENT_ACCESS, PHOTO_MANAGEMENT_REVIEW_PAGE, type PhotoManagementRequest } from '@/lib/photo-management-access';
import { useCurrentAccess } from '@/lib/use-current-role';
import { dashboardEvents, formatDashboardDate, type DashboardPhotoStat, type DashboardTournament, type EventRange, type PhotoMetric } from './dashboard-data';
import styles from './dashboard.module.css';

const ADMIN = '/nicaiyixiahh';
const DISPLAY_LIMIT = 6;
const number = new Intl.NumberFormat('zh-CN');
const photoColumns = [
  { key: 'photoCount', label: '图片' },
  { key: 'viewCount', label: '浏览' },
  { key: 'downloadCount', label: '下载' },
] as const;

type CompetitionSummary = { id: string; title: string; isArchived: boolean; counts: { pending: number } };
type ActivitySummary = { approvalStatus: string };
type Snapshot = {
  token: string;
  isRoot: boolean;
  canManagePhotos: boolean;
  canReviewRegistrations: boolean;
  refresh: number;
  now: Date;
  tournaments: DashboardTournament[] | null;
  stats: DashboardPhotoStat[] | null;
  competitions: CompetitionSummary[] | null;
  activities: ActivitySummary[] | null;
  usage: { aiChat: number } | null;
  requests: Pick<PhotoManagementRequest, 'status'>[] | null;
  partialFailure: boolean;
};

function formatCount(value: number | null | undefined) {
  return value == null ? '—' : number.format(value);
}

function Icon({ children, tone = 'blue' }: { children: ReactNode; tone?: string }) {
  return <span className={styles.icon} data-tone={tone} aria-hidden="true">{children}</span>;
}

function PanelTitle({ children, icon, tone }: { children: ReactNode; icon: ReactNode; tone?: string }) {
  return <h2 className={styles.panelTitle}><Icon tone={tone}>{icon}</Icon>{children}</h2>;
}

function Metric({ title, value, icon, tone }: { title: string; value?: number; icon: ReactNode; tone?: string }) {
  return <div className={styles.metric}>
    <Icon tone={tone}>{icon}</Icon>
    <div><span>{title}</span><strong>{formatCount(value)}</strong></div>
  </div>;
}

function TaskRow({ title, count, href, onClick }: { title: string; count?: number; href?: string; onClick?: () => void }) {
  const content = <><span>{title}</span><strong data-pending={!!count}>{formatCount(count)}</strong>
    {href || onClick ? <RightOutlined className={styles.chevron} aria-hidden="true" /> : null}</>;
  if (href) return <Link className={styles.task} href={href}>{content}</Link>;
  if (onClick) return <button className={styles.task} onClick={onClick} type="button">{content}</button>;
  return <div className={styles.task}>{content}</div>;
}

function PhotosPanel({ stats, isRoot, loading }: { stats: DashboardPhotoStat[] | null; isRoot: boolean; loading: boolean }) {
  const [order, setOrder] = useState<{ key: PhotoMetric; descending: boolean }>({ key: 'photoCount', descending: true });
  const [expanded, setExpanded] = useState(false);
  const rows = [...(stats ?? [])].sort((a, b) => {
    const delta = a[order.key] - b[order.key];
    return (order.descending ? -delta : delta) || a.name.localeCompare(b.name, 'zh-CN');
  });
  const maximum = rows.reduce((max, row) => Math.max(max, row[order.key]), 0);
  const metricLabel = photoColumns.find(({ key }) => key === order.key)?.label;
  return (
    <section className={styles.panel} aria-label="赛事图片">
      <header className={styles.panelHeader}>
        <PanelTitle icon={<PictureOutlined />} tone="green">赛事图片</PanelTitle>
        <div className={styles.links}>
          {isRoot && <Link href={`${ADMIN}/image-moderation`}>图片审核设置</Link>}
          <Link href={`${ADMIN}/photo-activities`}>图片管理</Link>
        </div>
      </header>
      <div className={styles.photoTotals}>
        {photoColumns.map(({ key, label }) => (
          <div key={key}>
            <strong>{formatCount(stats?.reduce((sum, row) => sum + row[key], 0))}</strong>
            <span>{key === 'photoCount' ? '图片总数' : `总${label}量`}</span>
          </div>
        ))}
      </div>
      {rows.length ? (
        <>
          <table className={styles.photoTable}>
            <caption className={styles.visuallyHidden}>各赛事图片统计。条形长度显示{metricLabel}相对于本列表最大值的比例。</caption>
            <thead>
              <tr>
                <th scope="col">赛事</th>
                {photoColumns.map(({ key, label }) => (
                  <th key={key} scope="col" aria-sort={order.key === key ? (order.descending ? 'descending' : 'ascending') : undefined}>
                    <button type="button" onClick={() => setOrder({ key, descending: key !== order.key || !order.descending })}>
                      {label}{order.key === key ? <span aria-hidden="true">{order.descending ? '↓' : '↑'}</span> : null}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(expanded ? rows : rows.slice(0, DISPLAY_LIMIT)).map((row) => (
                <tr key={row.id}>
                  <th scope="row">
                    <Link href={`${ADMIN}/competitions/${encodeURIComponent(row.id)}/photos`}>{row.name}</Link>
                    <div className={styles.bar} aria-hidden="true">
                      <span style={{ width: `${maximum ? row[order.key] / maximum * 100 : 0}%` }} />
                    </div>
                  </th>
                  {photoColumns.map(({ key }) => <td key={key}>{formatCount(row[key])}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > DISPLAY_LIMIT && (
            <button className={styles.expand} type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
              {expanded ? '收起' : `展开全部 ${rows.length} 个赛事`}
            </button>
          )}
        </>
      ) : <p className={styles.empty}>{loading ? '正在加载图片统计…' : stats ? '暂无赛事图片数据' : '图片统计暂时无法加载'}</p>}
    </section>
  );
}

export default function AdminDashboard() {
  const { data: session } = useSession();
  const access = useCurrentAccess();
  const token = session?.user?.accessToken;
  const isRoot = access.role === 'ROOT';
  const canEditTournaments = access.can('TOURNAMENTS');
  const canManagePhotos = access.can('PHOTOS');
  const canReviewRegistrations = access.can('PLAYERS');
  const canListCompetitions = canAccessAdminPage(access.role, `${ADMIN}/competitions`, access.permissions);
  const [range, setRange] = useState<EventRange>('today');
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [refresh, setRefresh] = useState(0);
  const [registrationsOpen, setRegistrationsOpen] = useState(false);
  const [eventsExpanded, setEventsExpanded] = useState(false);

  useEffect(() => {
    if (!token || !access.ready) return;
    const controller = new AbortController();
    const options = { token, cache: 'no-store' as const, redirectOnForbidden: false, signal: controller.signal };
    const get = <T,>(path: string, enabled = true) => enabled ? apiFetch<T>(path, options) : Promise.resolve(null);
    void Promise.allSettled([
      get<DashboardTournament[]>('/tournaments'),
      get<DashboardPhotoStat[]>('/admin/photos/tournaments', canManagePhotos),
      get<CompetitionSummary[]>('/admin/competitions', canReviewRegistrations),
      get<ActivitySummary[]>('/admin/photo-activities', isRoot),
      get<{ aiChat: number }>('/usage-metrics/summary', isRoot),
      get<Pick<PhotoManagementRequest, 'status'>[]>(`${PHOTO_MANAGEMENT_ACCESS}/requests`, isRoot),
    ]).then(([tournaments, stats, competitions, activities, usage, requests]) => {
      if (controller.signal.aborted) return;
      const value = <T,>(result: PromiseSettledResult<T | null>) => result.status === 'fulfilled' ? result.value : null;
      setSnapshot({
        token, isRoot, canManagePhotos, canReviewRegistrations, refresh, now: new Date(),
        tournaments: value(tournaments), stats: value(stats), competitions: value(competitions),
        activities: value(activities), usage: value(usage), requests: value(requests),
        partialFailure: [tournaments, stats, competitions, activities, usage, requests].some((result) => result.status === 'rejected'),
      });
    });
    return () => controller.abort();
  }, [token, access.ready, isRoot, canManagePhotos, canReviewRegistrations, refresh]);

  const data = snapshot?.token === token && snapshot?.isRoot === isRoot
    && snapshot.canManagePhotos === canManagePhotos && snapshot.canReviewRegistrations === canReviewRegistrations ? snapshot : undefined;
  const loading = !data || data.refresh !== refresh;
  const tournaments = data?.tournaments;
  const pendingApprovals = tournaments?.filter((tournament) => !tournament.isArchived && tournament.approvalStatus === 'PENDING').length;
  const pendingPhotos = data?.requests?.filter((request) => request.status === 'PENDING').length;
  const registrations = data?.competitions
    ?.filter((competition) => !competition.isArchived && competition.counts.pending > 0)
    .sort((a, b) => b.counts.pending - a.counts.pending);
  const pendingRegistrations = registrations?.reduce((total, row) => total + row.counts.pending, 0);
  const taskCount = isRoot && pendingApprovals !== undefined && pendingPhotos !== undefined && pendingRegistrations !== undefined
    ? pendingApprovals + pendingPhotos + pendingRegistrations : undefined;
  const events = tournaments && data ? dashboardEvents(tournaments, range, data.now) : [];
  const eventCount = tournaments?.reduce((sum, item) => sum + (item._count?.events ?? 0) + (item.teamCompetitions?.length ?? 0), 0);

  return (
    <div className={styles.dashboard} aria-busy={loading}>
      <header className={styles.heading}>
        <div>
          <p className={styles.date}>{data ? <><CalendarOutlined aria-hidden="true" /> {formatDashboardDate(data.now)}</> : '赛事管理'}</p>
          <h1>赛事工作台</h1>
        </div>
        <div className={styles.actions}>
          <Button icon={<ReloadOutlined />} aria-label="刷新仪表盘" loading={loading} onClick={() => setRefresh((current) => current + 1)}>
            <span className={styles.refreshLabel}>刷新</span>
          </Button>
          {canEditTournaments && <Link className={styles.primary} href={`${ADMIN}/tournaments?create=1`}><PlusOutlined aria-hidden="true" />新建赛事</Link>}
        </div>
      </header>
      {data?.partialFailure && <Alert type="warning" showIcon title="部分数据暂时无法加载，可以刷新重试。" />}
      <div className={styles.work}>
        <section className={styles.panel} aria-label="待办事项">
          <header className={styles.panelHeader}>
            <PanelTitle icon={<InboxOutlined />} tone="amber">待办事项</PanelTitle>
            {taskCount !== undefined && <span className={styles.badge} data-tone={taskCount ? 'amber' : 'muted'}>{taskCount ? `${formatCount(taskCount)} 项待处理` : '暂无待办'}</span>}
          </header>
          {isRoot && <TaskRow title="图片管理申请" count={pendingPhotos} href={PHOTO_MANAGEMENT_REVIEW_PAGE} />}
          {canReviewRegistrations && <TaskRow title="待审核报名" count={pendingRegistrations} onClick={() => setRegistrationsOpen(true)} />}
          <TaskRow title="赛事待审核" count={pendingApprovals} href={isRoot ? `${ADMIN}/approvals` : undefined} />
        </section>
        <section className={styles.panel} aria-label="赛事动态">
          <header className={styles.panelHeader}>
            <PanelTitle icon={<CalendarOutlined />}>赛事动态</PanelTitle>
            <div className={styles.range} role="group" aria-label="赛事日期范围">
              <button type="button" aria-pressed={range === 'today'} onClick={() => { setRange('today'); setEventsExpanded(false); }}>今天</button>
              <button type="button" aria-pressed={range === 'upcoming'} onClick={() => { setRange('upcoming'); setEventsExpanded(false); }}>近期</button>
            </div>
          </header>
          <div aria-live="polite">
            {events.length ? (eventsExpanded ? events : events.slice(0, DISPLAY_LIMIT)).map(({ key, tournament, label, timing, tone }) => (
              <Link key={key} className={styles.event} href={canEditTournaments
                ? `${ADMIN}/tournaments?edit=${encodeURIComponent(tournament.id)}`
                : `/competitions/${encodeURIComponent(tournament.id)}`}>
                <span><strong>{tournament.name}</strong><small>{timing}{tournament.location ? ` · ${tournament.location}` : ''}</small></span>
                <span className={styles.badge} data-tone={tone}>{label}</span>
              </Link>
            )) : <p className={styles.empty}>{loading ? '正在加载赛事…' : !tournaments ? '赛事动态暂时无法加载' : range === 'today' ? '今天暂无开赛或报名截止安排' : '未来 7 天暂无开赛或报名截止安排'}</p>}
          </div>
          {events.length > DISPLAY_LIMIT && <button className={styles.expand} type="button" aria-expanded={eventsExpanded} onClick={() => setEventsExpanded(!eventsExpanded)}>{eventsExpanded ? '收起' : `展开全部 ${events.length} 条`}</button>}
        </section>
      </div>
      <section aria-label="赛事概况" className={styles.overview}>
        <header className={styles.overviewHeader}>
          <div><h2>赛事概况</h2><span>{formatCount(eventCount)} 个比赛项目</span></div>
          {canListCompetitions && <Link href={`${ADMIN}/competitions`}>赛事管理 <RightOutlined aria-hidden="true" /></Link>}
        </header>
        <div className={styles.metricGrid}>
          <Metric title="赛事总数" value={tournaments?.length} icon={<TrophyOutlined />} />
          <Metric title="已发布" value={tournaments?.filter((item) => item.isPublished && !item.isArchived).length} icon={<CheckCircleOutlined />} tone="green" />
          <Metric title="未发布" value={tournaments?.filter((item) => !item.isPublished && !item.isArchived).length} icon={<ClockCircleOutlined />} tone="muted" />
          <Metric title="已归档" value={tournaments?.filter((item) => item.isArchived).length} icon={<InboxOutlined />} tone="muted" />
        </div>
      </section>
      {canManagePhotos && <PhotosPanel stats={data?.stats ?? null} isRoot={isRoot} loading={loading} />}
      {isRoot && (
        <div className={styles.footerStats}>
          <Link href={`${ADMIN}/photo-activities`}><PictureOutlined aria-hidden="true" />独立活动 <strong>{formatCount(data?.activities?.length)}</strong>
            {data?.activities?.some((activity) => activity.approvalStatus === 'PENDING') && <span className={styles.badge} data-tone="amber">{data.activities.filter((activity) => activity.approvalStatus === 'PENDING').length} 待审核</span>}
          </Link>
          <span><MessageOutlined aria-hidden="true" /> AI 对话 <strong>{formatCount(data?.usage?.aiChat)}</strong></span>
        </div>
      )}
      <Modal title="待审核报名" open={canReviewRegistrations && registrationsOpen} footer={null} onCancel={() => setRegistrationsOpen(false)}>
        <div className={styles.registrationList}>
          {registrations?.length ? registrations.map((row) => (
            <Link key={row.id} href={`${ADMIN}/competitions/${encodeURIComponent(row.id)}/registrations`} className={styles.task}>
              <span>{row.title}</span><strong data-pending="true">{formatCount(row.counts.pending)} 条</strong><RightOutlined className={styles.chevron} aria-hidden="true" />
            </Link>
          )) : <p className={styles.empty}>{loading ? '正在加载报名…' : registrations ? '暂无报名待审核' : '待审核报名暂时无法加载'}</p>}
        </div>
      </Modal>
    </div>
  );
}
