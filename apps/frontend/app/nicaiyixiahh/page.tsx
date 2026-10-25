'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Button, Card, Col, Empty, Progress, Row, Space, Table, Tag, Typography } from 'antd';
import {
  AuditOutlined,
  BranchesOutlined,
  CalendarOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  DownloadOutlined,
  FieldTimeOutlined,
  MessageOutlined,
  PauseCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  ScheduleOutlined,
  TrophyOutlined,
} from '@ant-design/icons';
import { apiFetch } from '@/lib/api';
import { useCurrentAccess } from '@/lib/use-current-role';

type TournamentStat = {
  id: string;
  name: string;
  edition: number;
  photoCount: number;
  viewCount: number;
  downloadCount: number;
};

type TournamentSummary = {
  id: string;
  name: string;
  edition: number;
  status: string;
  startDate: string;
  endDate: string;
  isPublished: boolean;
  isArchived: boolean;
  approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
  _count?: { events: number };
  teamCompetitions?: Array<{ id: string }>;
};

type TournamentRow = TournamentSummary & {
  photoCount: number;
  viewCount: number;
  downloadCount: number;
};

type UsageMetrics = {
  aiChat: number;
};

type PhotoActivityStat = {
  id: string;
  title: string;
  dateMode: 'SINGLE' | 'RANGE';
  startAt: string;
  endAt: string | null;
  approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
  photoCount: number;
};

const EMPTY_USAGE_METRICS: UsageMetrics = {
  aiChat: 0,
};

const TOURNAMENT_STATUS_LABELS: Record<string, string> = {
  REGISTRATION_NOT_STARTED: '报名未开始',
  REGISTRATION_OPEN: '报名中',
  REGISTRATION_CLOSED: '报名截止',
  ONGOING: '进行中',
  FINISHED: '已结束',
};

const ACTIVITY_STATUS = {
  PENDING: { color: '#d97706', label: '待审核' },
  APPROVED: { color: '#16a34a', label: '已通过' },
  REJECTED: { color: '#dc2626', label: '已驳回' },
} as const;

function formatDate(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('zh-CN');
}

function formatActivityTime(activity: PhotoActivityStat) {
  const start = new Date(activity.startAt).toLocaleString('zh-CN', { hour12: false });
  if (activity.dateMode === 'SINGLE' || !activity.endAt) return start;
  return `${start} 至 ${new Date(activity.endAt).toLocaleString('zh-CN', { hour12: false })}`;
}

function MetricCard({
  label,
  value,
  hint,
  icon,
  accent,
}: {
  label: string;
  value: number;
  hint: string;
  icon: React.ReactNode;
  accent: string;
}) {
  return (
    <Card size="small" style={{ height: '100%' }} styles={{ body: { padding: '14px 16px' } }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div
          style={{
            display: 'grid',
            width: 38,
            height: 38,
            flex: 'none',
            placeItems: 'center',
            borderRadius: 11,
            background: `${accent}14`,
            color: accent,
            fontSize: 18,
          }}
        >
          {icon}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ color: '#64748b', fontSize: 12, fontWeight: 600 }}>{label}</div>
          <div style={{ color: '#0f172a', fontSize: 24, fontWeight: 800, lineHeight: 1.1 }}>
            {value.toLocaleString()}
          </div>
          <div style={{ marginTop: 2, color: '#94a3b8', fontSize: 11 }}>{hint}</div>
        </div>
      </div>
    </Card>
  );
}

export default function AdminDashboard() {
  const router = useRouter();
  const { data: session } = useSession();
  const access = useCurrentAccess();
  const token = session?.user?.accessToken as string | undefined;
  const role = access.role ?? session?.user?.role;
  const isRoot = role === 'ROOT';

  const [tournaments, setTournaments] = useState<TournamentSummary[]>([]);
  const [stats, setStats] = useState<TournamentStat[]>([]);
  const [activityStats, setActivityStats] = useState<PhotoActivityStat[]>([]);
  const [usageMetrics, setUsageMetrics] = useState<UsageMetrics>(EMPTY_USAGE_METRICS);
  const [loading, setLoading] = useState(true);

  const loadDashboard = useCallback(async () => {
    if (!token) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [tournamentData, photoStats, usageStats, activityData] = await Promise.all([
        apiFetch<TournamentSummary[]>('/tournaments', { token, cache: 'no-store' }).catch(() => []),
        apiFetch<TournamentStat[]>('/admin/photos/tournaments', { token, cache: 'no-store' }).catch(() => []),
        isRoot
          ? apiFetch<UsageMetrics>('/usage-metrics/summary', { token, cache: 'no-store' }).catch(() => EMPTY_USAGE_METRICS)
          : Promise.resolve(EMPTY_USAGE_METRICS),
        isRoot
          ? apiFetch<PhotoActivityStat[]>('/admin/photo-activities', { token, cache: 'no-store' }).catch(() => [])
          : Promise.resolve([]),
      ]);
      setTournaments(tournamentData);
      setStats(photoStats);
      setUsageMetrics(usageStats);
      setActivityStats(activityData);
    } finally {
      setLoading(false);
    }
  }, [token, isRoot]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadDashboard();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadDashboard]);

  const photoMap = useMemo(() => new Map(stats.map((item) => [item.id, item])), [stats]);

  const tournamentRows = useMemo<TournamentRow[]>(
    () =>
      tournaments.map((tournament) => {
        const photo = photoMap.get(tournament.id);
        return {
          ...tournament,
          photoCount: photo?.photoCount ?? 0,
          viewCount: photo?.viewCount ?? 0,
          downloadCount: photo?.downloadCount ?? 0,
        };
      }),
    [photoMap, tournaments],
  );

  const totalPhotos = stats.reduce((sum, item) => sum + item.photoCount, 0);
  const totalViews = stats.reduce((sum, item) => sum + item.viewCount, 0);
  const totalDownloads = stats.reduce((sum, item) => sum + item.downloadCount, 0);
  const totalActivityPhotos = activityStats.reduce((sum, activity) => sum + activity.photoCount, 0);
  const pendingActivities = activityStats.filter((activity) => activity.approvalStatus === 'PENDING').length;
  const approvedActivities = activityStats.filter((activity) => activity.approvalStatus === 'APPROVED').length;
  const publishedCount = tournaments.filter((tournament) => tournament.isPublished && !tournament.isArchived).length;
  const archivedCount = tournaments.filter((tournament) => tournament.isArchived).length;
  const pendingApprovalCount = tournaments.filter(
    (tournament) => tournament.approvalStatus === 'PENDING' && !tournament.isArchived,
  ).length;
  const unpublishedCount = tournaments.filter(
    (tournament) => !tournament.isPublished && !tournament.isArchived,
  ).length;
  const eventCount = tournaments.reduce(
    (sum, tournament) =>
      sum + (tournament._count?.events ?? 0) + (tournament.teamCompetitions?.length ?? 0),
    0,
  );

  const quickLinks = [
    {
      label: '新建赛事',
      href: '/nicaiyixiahh/tournaments?create=1',
      icon: <PlusOutlined />,
      show: access.can('TOURNAMENTS'),
    },
    {
      label: '赛事管理',
      href: '/nicaiyixiahh/competitions',
      icon: <TrophyOutlined />,
      show: access.can('TOURNAMENTS') || access.can('PLAYERS'),
    },
    {
      label: '抽签编排',
      href: '/nicaiyixiahh/draws',
      icon: <BranchesOutlined />,
      show: access.can('DRAWS'),
    },
    {
      label: '场地排程',
      href: '/nicaiyixiahh/scheduling',
      icon: <CalendarOutlined />,
      show: access.can('SCHEDULING'),
    },
    {
      label: '裁判分配',
      href: '/nicaiyixiahh/scoring',
      icon: <FieldTimeOutlined />,
      show: access.can('SCORING'),
    },
    {
      label: '对局管理',
      href: '/nicaiyixiahh/match-management',
      icon: <ScheduleOutlined />,
      show: role === 'ROOT',
    },
    {
      label: '数据导出',
      href: '/nicaiyixiahh/exports',
      icon: <DownloadOutlined />,
      show: access.can('ORDERBOOK') || access.can('DATA_EXPORT'),
    },
    {
      label: '图片审核',
      href: '/nicaiyixiahh/image-moderation',
      icon: <AuditOutlined />,
      show: role === 'ROOT',
    },
  ].filter((item) => item.show);

  const tournamentColumns = [
    {
      title: '赛事',
      key: 'name',
      width: 230,
      render: (_: unknown, row: TournamentRow) => (
        <div style={{ minWidth: 0 }}>
          <Typography.Text
            strong
            ellipsis={{ tooltip: row.name }}
            style={{ display: 'block', fontSize: 13 }}
          >
            {row.name}
          </Typography.Text>
          <div style={{ marginTop: 2, color: '#94a3b8', fontSize: 11 }}>
            第 {row.edition} 届 · {formatDate(row.startDate)} 至 {formatDate(row.endDate)}
          </div>
        </div>
      ),
    },
    {
      title: '状态',
      key: 'status',
      width: 150,
      render: (_: unknown, row: TournamentRow) => (
        <Space size={4} wrap>
          <Tag
            color={row.isArchived ? 'default' : row.isPublished ? 'blue' : 'default'}
            style={{ marginInlineEnd: 0 }}
          >
            {row.isArchived ? '已归档' : row.isPublished ? '已发布' : '未发布'}
          </Tag>
          {row.isPublished && !row.isArchived ? (
            <Tag color="cyan" style={{ marginInlineEnd: 0 }}>
              {TOURNAMENT_STATUS_LABELS[row.status] ?? row.status}
            </Tag>
          ) : null}
          {row.approvalStatus === 'PENDING' ? (
            <Tag color="gold" style={{ marginInlineEnd: 0 }}>待审核</Tag>
          ) : row.approvalStatus === 'REJECTED' ? (
            <Tag color="red" style={{ marginInlineEnd: 0 }}>已驳回</Tag>
          ) : null}
        </Space>
      ),
    },
    {
      title: '项目',
      key: 'events',
      width: 60,
      render: (_: unknown, row: TournamentRow) => (
        <Typography.Text style={{ fontSize: 12 }}>
          {(row._count?.events ?? 0) + (row.teamCompetitions?.length ?? 0)}
        </Typography.Text>
      ),
    },
    {
      title: '图片',
      dataIndex: 'photoCount',
      key: 'photoCount',
      width: 60,
      render: (value: number) => <Typography.Text style={{ fontSize: 12 }}>{value}</Typography.Text>,
    },
    {
      title: '浏览',
      dataIndex: 'viewCount',
      key: 'viewCount',
      width: 70,
      render: (value: number) => <Typography.Text style={{ fontSize: 12 }}>{value.toLocaleString()}</Typography.Text>,
    },
    {
      title: '下载',
      dataIndex: 'downloadCount',
      key: 'downloadCount',
      width: 70,
      render: (value: number) => <Typography.Text style={{ fontSize: 12 }}>{value.toLocaleString()}</Typography.Text>,
    },
    {
      title: '操作',
      key: 'actions',
      width: 80,
      render: (_: unknown, row: TournamentRow) => (
        <Button
          type="link"
          size="small"
          onClick={() =>
            router.push(
              access.can('PHOTOS')
                ? `/nicaiyixiahh/competitions/${encodeURIComponent(row.id)}/photos`
                : '/nicaiyixiahh/competitions',
            )
          }
        >
          查看
        </Button>
      ),
    },
  ];

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>
            仪表盘
          </Typography.Title>
          <Typography.Text type="secondary">
            欢迎回来，{session?.user?.name ?? '管理员'}。这里汇总赛事、图片和智能工具的运营数据。
          </Typography.Text>
        </div>
        <Space wrap>
          <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void loadDashboard()}>
            刷新
          </Button>
          {access.can('TOURNAMENTS') ? (
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => router.push('/nicaiyixiahh/tournaments?create=1')}
            >
              新建赛事
            </Button>
          ) : null}
          {access.can('TOURNAMENTS') || access.can('PLAYERS') ? (
            <Button icon={<TrophyOutlined />} onClick={() => router.push('/nicaiyixiahh/competitions')}>
              赛事管理
            </Button>
          ) : null}
        </Space>
      </div>

      <div
        className={`mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 ${
          isRoot ? 'xl:grid-cols-6' : 'xl:grid-cols-4'
        }`}
      >
        <MetricCard
          label="赛事总数"
          value={tournaments.length}
          hint={`${eventCount} 个比赛项目${archivedCount ? ` · ${archivedCount} 个归档` : ''}`}
          icon={<TrophyOutlined />}
          accent="#2563eb"
        />
        <MetricCard
          label="已发布"
          value={publishedCount}
          hint={`${unpublishedCount} 个未发布`}
          icon={<CheckCircleOutlined />}
          accent="#16a34a"
        />
        <MetricCard
          label="待审核"
          value={pendingApprovalCount}
          hint={isRoot ? '等待审批' : '等待超级管理员审批'}
          icon={<ClockCircleOutlined />}
          accent="#d97706"
        />
        <MetricCard
          label="未发布"
          value={unpublishedCount}
          hint={`${archivedCount} 个归档赛事`}
          icon={<PauseCircleOutlined />}
          accent="#64748b"
        />
        {isRoot ? (
          <MetricCard
            label="AI 对话"
            value={usageMetrics.aiChat}
            hint="累计对话次数"
            icon={<MessageOutlined />}
            accent="#4f46e5"
          />
        ) : null}
        {isRoot ? (
          <MetricCard
            label="活动图片"
            value={totalActivityPhotos}
            hint={`${pendingActivities} 个活动待审`}
            icon={<CalendarOutlined />}
            accent="#db2777"
          />
        ) : null}
      </div>

      <Card
        style={{ marginTop: 16 }}
        title={<span style={{ fontSize: 14, fontWeight: 700 }}>图片统计</span>}
        extra={
          <Space size={4} wrap>
            {isRoot ? (
              <Button type="link" size="small" onClick={() => router.push('/nicaiyixiahh/image-moderation')}>
                图片审核设置
              </Button>
            ) : null}
            <Button type="link" size="small" onClick={() => router.push('/nicaiyixiahh/competitions')}>
              图片管理
            </Button>
          </Space>
        }
      >
        <div style={{ display: 'flex', gap: 40, flexWrap: 'wrap', justifyContent: 'space-around' }}>
          <div style={{ textAlign: 'center' }}>
            <Progress
              type="circle"
              size={84}
              percent={stats.length ? 100 : 0}
              strokeColor={{ '0%': '#1677ff', '100%': '#0958d9' }}
              format={() => totalPhotos.toLocaleString()}
            />
            <div style={{ marginTop: 6, color: '#64748b', fontSize: 12, fontWeight: 600 }}>图片总数</div>
            <div style={{ color: '#94a3b8', fontSize: 11 }}>覆盖 {stats.length} 个赛事</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <Progress
              type="circle"
              size={84}
              percent={totalViews + totalDownloads > 0
                ? Math.round((totalViews / (totalViews + totalDownloads)) * 100)
                : 0}
              strokeColor={{ '0%': '#52c41a', '100%': '#389e0d' }}
              format={() => totalViews.toLocaleString()}
            />
            <div style={{ marginTop: 6, color: '#64748b', fontSize: 12, fontWeight: 600 }}>总浏览量</div>
            <div style={{ color: '#94a3b8', fontSize: 11 }}>累计图片浏览</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <Progress
              type="circle"
              size={84}
              percent={totalViews + totalDownloads > 0
                ? Math.round((totalDownloads / (totalViews + totalDownloads)) * 100)
                : 0}
              strokeColor={{ '0%': '#faad14', '100%': '#d48806' }}
              format={() => totalDownloads.toLocaleString()}
            />
            <div style={{ marginTop: 6, color: '#64748b', fontSize: 12, fontWeight: 600 }}>总下载量</div>
            <div style={{ color: '#94a3b8', fontSize: 11 }}>累计原图下载</div>
          </div>
        </div>

        <div style={{ height: 1, margin: '18px 0 14px', background: '#eef2f7' }} />

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <Typography.Text strong style={{ fontSize: 13 }}>各赛事图片统计</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            仅展示已有图片的赛事
          </Typography.Text>
        </div>
        {stats.length ? (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
              gap: 12,
              marginTop: 12,
            }}
          >
            {stats.map((stat) => {
              const interactions = stat.viewCount + stat.downloadCount;
              return (
                <div
                  key={stat.id}
                  style={{
                    padding: '12px 14px',
                    border: '1px solid #eef2f7',
                    borderRadius: 10,
                    background: '#fff',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                    <Typography.Text
                      strong
                      ellipsis={{ tooltip: stat.name }}
                      style={{ fontSize: 13, minWidth: 0 }}
                    >
                      {stat.name}
                    </Typography.Text>
                    <Button
                      type="link"
                      size="small"
                      style={{ flex: 'none' }}
                      onClick={() => router.push(`/nicaiyixiahh/competitions/${encodeURIComponent(stat.id)}/photos`)}
                    >
                      管理
                    </Button>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-around', marginTop: 8, gap: 8 }}>
                    <div style={{ textAlign: 'center' }}>
                      <Progress
                        type="circle"
                        size={62}
                        percent={Math.min(100, stat.photoCount * 10)}
                        strokeColor="#1677ff"
                        format={() => stat.photoCount.toString()}
                      />
                      <div style={{ marginTop: 4, color: '#64748b', fontSize: 11 }}>图片</div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <Progress
                        type="circle"
                        size={62}
                        percent={interactions > 0 ? Math.round((stat.viewCount / interactions) * 100) : 0}
                        strokeColor="#52c41a"
                        format={() => stat.viewCount.toString()}
                      />
                      <div style={{ marginTop: 4, color: '#64748b', fontSize: 11 }}>浏览</div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <Progress
                        type="circle"
                        size={62}
                        percent={interactions > 0 ? Math.round((stat.downloadCount / interactions) * 100) : 0}
                        strokeColor="#faad14"
                        format={() => stat.downloadCount.toString()}
                      />
                      <div style={{ marginTop: 4, color: '#64748b', fontSize: 11 }}>下载</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无赛事图片数据" style={{ marginTop: 12 }} />
        )}
      </Card>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} xl={16}>
          <Card
            title={<span style={{ fontSize: 14, fontWeight: 700 }}>赛事概览</span>}
            extra={
              <Button type="link" size="small" onClick={() => router.push('/nicaiyixiahh/competitions')}>
                全部赛事
              </Button>
            }
            styles={{ body: { padding: 0 } }}
          >
            <Table
              rowKey="id"
              columns={tournamentColumns}
              dataSource={tournamentRows}
              loading={loading}
              pagination={false}
              scroll={{ x: 720 }}
              tableLayout="fixed"
              size="small"
              locale={{ emptyText: '暂无赛事' }}
            />
          </Card>
        </Col>
        <Col xs={24} xl={8}>
          <Card
            title={<span style={{ fontSize: 14, fontWeight: 700 }}>快捷入口</span>}
            style={{ height: '100%' }}
            styles={{ body: { padding: 16 } }}
          >
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {quickLinks.map((item) => (
                <Button
                  key={item.href}
                  block
                  icon={item.icon}
                  onClick={() => router.push(item.href)}
                  style={{ justifyContent: 'flex-start', height: 40, fontSize: 12 }}
                >
                  {item.label}
                </Button>
              ))}
            </div>
            <Typography.Text type="secondary" style={{ display: 'block', marginTop: 14, fontSize: 12 }}>
              更多功能可从左侧菜单进入。
            </Typography.Text>
          </Card>
        </Col>
      </Row>

      {isRoot ? (
        <Card
          style={{ marginTop: 16 }}
          title={<span style={{ fontSize: 14, fontWeight: 700 }}>活动图片</span>}
          extra={
            <Button type="link" size="small" onClick={() => router.push('/nicaiyixiahh/photo-activities')}>
              管理活动图片
            </Button>
          }
        >
          {activityStats.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无活动图片数据" />
          ) : (
            <>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                  gap: 12,
                }}
              >
                {[
                  { label: '活动总数', value: activityStats.length, color: '#2563eb' },
                  { label: '待审核', value: pendingActivities, color: '#d97706' },
                  { label: '已通过', value: approvedActivities, color: '#16a34a' },
                  { label: '活动图片总数', value: totalActivityPhotos, color: '#7c3aed' },
                ].map((item) => (
                  <div
                    key={item.label}
                    style={{
                      padding: '12px 14px',
                      border: '1px solid #eef2f7',
                      borderRadius: 10,
                      background: '#f8fafc',
                    }}
                  >
                    <div style={{ color: '#64748b', fontSize: 12, fontWeight: 600 }}>{item.label}</div>
                    <div style={{ marginTop: 4, color: item.color, fontSize: 22, fontWeight: 800, lineHeight: 1.1 }}>
                      {item.value.toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                  gap: 12,
                  marginTop: 14,
                }}
              >
                {activityStats.slice(0, 4).map((activity) => {
                  const status = ACTIVITY_STATUS[activity.approvalStatus];
                  return (
                    <div
                      key={activity.id}
                      style={{
                        padding: '12px 14px',
                        border: '1px solid #eef2f7',
                        borderRadius: 10,
                        background: '#fff',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                        <Typography.Text strong ellipsis={{ tooltip: activity.title }} style={{ fontSize: 13 }}>
                          {activity.title}
                        </Typography.Text>
                        <Tag color={status.color} style={{ marginInlineEnd: 0, flex: 'none' }}>
                          {status.label}
                        </Tag>
                      </div>
                      <Typography.Text type="secondary" style={{ display: 'block', marginTop: 6, fontSize: 12 }}>
                        {formatActivityTime(activity)}
                      </Typography.Text>
                      <div style={{ marginTop: 8, color: '#7c3aed', fontSize: 12, fontWeight: 700 }}>
                        {activity.photoCount} 张图片
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </Card>
      ) : null}
    </div>
  );
}
