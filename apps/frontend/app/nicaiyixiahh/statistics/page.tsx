'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Badge, Button, Card, Empty, Select, Space, Typography, message } from 'antd';
import { ReloadOutlined, ToolOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { apiFetch } from '@/lib/api';
import { useCurrentAccess } from '@/lib/use-current-role';
import {
  ChartCard,
  HorizontalBars,
  ShareBar,
  StatTile,
  formatCount,
  type BarItem,
  type SeriesKey,
} from '@/components/statistics/StatsCharts';
import { SchoolMergeModal, type MergeSuggestion } from '@/components/statistics/SchoolMergeModal';

type Tournament = { id: string; name: string };
type EntrantType = 'SCHOOL' | 'SOCIAL';

type EventStat = { key: string; label: string; people: number; pairs: number | null; teams: number | null };
type SchoolRankItem = { name: string; people: number; variants: Array<{ name: string; people: number }> };
type SchoolStats = {
  count: number;
  top: SchoolRankItem[];
  ranking: SchoolRankItem[];
  unspecifiedPeople: number;
  ignored: Array<{ name: string; people: number }>;
  suggestions: MergeSuggestion[];
};
type GroupStats = {
  entrantType: EntrantType;
  groupId?: string;
  label: string;
  people: number;
  pendingRegistrations: number;
  events: EventStat[];
  schools: SchoolStats | null;
};
type TournamentStatistics = { tournament: Tournament; generatedAt: string; groups: GroupStats[] };

const SERIES_BY_GROUP: Record<EntrantType, SeriesKey> = { SCHOOL: 'school', SOCIAL: 'social' };
const SCHOOL_TOP = 10;

function eventValueText(event: EventStat) {
  const people = `${formatCount(event.people)} 人`;
  if (event.pairs !== null) return `${people} · ${formatCount(event.pairs)} 对`;
  if (event.teams !== null) return `${people} · ${formatCount(event.teams)} 队`;
  return people;
}

function variantsText(item: SchoolRankItem) {
  return item.variants.length
    ? `含写法：${item.variants.map((variant) => `${variant.name}×${variant.people}`).join('、')}`
    : '';
}

export default function StatisticsPage() {
  const { data: session } = useSession();
  const token = session?.user?.accessToken as string | undefined;
  const access = useCurrentAccess();
  const isRoot = access.role === 'ROOT';

  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [tournamentId, setTournamentId] = useState('');
  const [stats, setStats] = useState<TournamentStatistics | null>(null);
  const [loading, setLoading] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [showAllSchools, setShowAllSchools] = useState(false);

  useEffect(() => {
    if (!token) return;
    apiFetch<Tournament[]>('/tournaments', { token })
      .then((data) => {
        setTournaments(data);
        setTournamentId((current) => current || data[0]?.id || '');
      })
      .catch((error) => message.error(error instanceof Error ? error.message : '加载赛事失败'));
  }, [token]);

  const load = useCallback(async () => {
    if (!token || !tournamentId) return;
    setLoading(true);
    try {
      setStats(await apiFetch<TournamentStatistics>(`/admin/statistics/tournaments/${tournamentId}`, { token, cache: 'no-store' }));
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载统计失败');
    } finally {
      setLoading(false);
    }
  }, [token, tournamentId]);

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => (cancelled ? undefined : load()));
    return () => {
      cancelled = true;
    };
  }, [load]);

  const current = stats?.tournament.id === tournamentId ? stats : null;
  const groups = current?.groups ?? [];
  const schoolGroup = groups.find((group) => group.entrantType === 'SCHOOL');
  const suggestionCount = schoolGroup?.schools?.suggestions.length ?? 0;
  const totalPeople = groups.reduce((sum, group) => sum + group.people, 0);

  const mergeNames = useMemo(
    () => (schoolGroup?.schools?.ranking ?? []).map((item) => ({ name: item.name, people: item.people })),
    [schoolGroup],
  );

  return (
    <Space orientation="vertical" size={16} style={{ width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>赛事统计</Typography.Title>
          <Typography.Text type="secondary">
            {access.role === 'ADMIN' ? '只显示你创建的赛事。' : ''}
            统计已通过的报名（含后台录入、Excel 导入）；双打两人都算，同一人兼报多个项目只算 1 人，团体赛队员也计入。
          </Typography.Text>
        </div>
        <Space wrap>
          {isRoot && schoolGroup ? (
            <Badge count={suggestionCount} size="small" offset={[-4, 4]}>
              <Button icon={<ToolOutlined />} onClick={() => setMergeOpen(true)}>整理学校名称</Button>
            </Badge>
          ) : null}
          <Button icon={<ReloadOutlined />} onClick={load} loading={loading} disabled={!tournamentId}>刷新</Button>
        </Space>
      </div>

      <Card size="small">
        <Space wrap size={16} align="center">
          <Select
            style={{ width: 360 }}
            value={tournamentId || undefined}
            placeholder="选择赛事"
            showSearch
            optionFilterProp="label"
            options={tournaments.map((item) => ({ value: item.id, label: item.name }))}
            onChange={(value) => {
              setTournamentId(value);
              // 换赛事时收起高校排行；同一赛事刷新（例如归并后）保持展开状态。
              setShowAllSchools(false);
            }}
            notFoundContent={<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无赛事" />}
          />
          {current ? (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              更新于 {dayjs(current.generatedAt).format('HH:mm:ss')}
            </Typography.Text>
          ) : null}
        </Space>
      </Card>

      {/* 刷新时保留上一次的结果并调淡，不闪白、不跳动。 */}
      <div style={{ opacity: loading && current ? 0.55 : 1, transition: 'opacity 160ms ease' }}>
        {!tournamentId ? (
          <Card><Empty description="请选择赛事" /></Card>
        ) : !current ? (
          <Card loading />
        ) : !groups.length ? (
          <Card><Empty description="该赛事还没有开设项目或团体赛" /></Card>
        ) : (
          <Space orientation="vertical" size={16} style={{ width: '100%' }}>
            {groups.length > 1 ? (
              <Card size="small" title="报名总览">
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(160px, auto) minmax(0, 1fr)', gap: 24, alignItems: 'center' }}>
                  <div>
                    <div style={{ color: '#52514e', fontSize: 13 }}>全部报名人数</div>
                    <div style={{ fontSize: 48, fontWeight: 600, lineHeight: 1.1 }}>
                      {formatCount(totalPeople)}
                      <span style={{ fontSize: 16, fontWeight: 400, color: '#52514e', marginLeft: 4 }}>人</span>
                    </div>
                  </div>
                  <ShareBar
                    ariaLabel="各组别报名人数占比"
                    parts={groups.map((group) => ({
                      key: group.groupId || group.entrantType,
                      label: group.label,
                      value: group.people,
                      series: SERIES_BY_GROUP[group.entrantType],
                    }))}
                  />
                </div>
              </Card>
            ) : null}

            {groups.map((group) => (
              <GroupSection
                key={group.groupId || group.entrantType}
                group={group}
                showAllSchools={showAllSchools}
                onToggleSchools={() => setShowAllSchools((value) => !value)}
              />
            ))}
          </Space>
        )}
      </div>

      {isRoot && schoolGroup?.schools ? (
        <SchoolMergeModal
          open={mergeOpen}
          onClose={() => setMergeOpen(false)}
          token={token}
          schoolNames={mergeNames}
          ignoredNames={schoolGroup.schools.ignored.map((item) => item.name)}
          suggestions={schoolGroup.schools.suggestions}
          onChanged={load}
        />
      ) : null}
    </Space>
  );
}

function GroupSection({ group, showAllSchools, onToggleSchools }: {
  group: GroupStats;
  showAllSchools: boolean;
  onToggleSchools: () => void;
}) {
  const series = SERIES_BY_GROUP[group.entrantType];
  const schools = group.schools;
  const eventItems: BarItem[] = group.events.map((event) => ({
    key: event.key,
    label: event.label,
    value: event.people,
    valueText: eventValueText(event),
  }));
  const ranking = schools?.ranking ?? [];
  const visibleSchools = showAllSchools ? ranking : ranking.slice(0, SCHOOL_TOP);
  const schoolItems: BarItem[] = visibleSchools.map((item, index) => ({
    key: item.name,
    label: `${index + 1}. ${item.name}`,
    value: item.people,
    details: item.variants.length ? [variantsText(item)] : undefined,
  }));
  const topText = schools?.top.length
    ? schools.top.map((item) => item.name).join('、')
    : '—';

  return (
    <Card
      title={(
        <Space size={8}>
          <span aria-hidden style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: series === 'school' ? '#2a78d6' : '#eb6834' }} />
          <span>{group.label}</span>
        </Space>
      )}
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        <StatTile
          label="报名人数"
          value={formatCount(group.people)}
          unit="人"
          note={group.pendingRegistrations ? `另有 ${formatCount(group.pendingRegistrations)} 份报名待审核，未计入` : undefined}
        />
        {schools ? (
          <>
            <StatTile
              label="参赛高校"
              value={formatCount(schools.count)}
              unit="所"
              note={schools.unspecifiedPeople ? `${formatCount(schools.unspecifiedPeople)} 人未填写学校，不计入` : undefined}
            />
            <StatTile
              label={schools.top.length > 1 ? '人数最多的高校（并列）' : '人数最多的高校'}
              value={<span style={{ fontSize: topText.length > 12 ? 18 : 22 }}>{topText}</span>}
              note={schools.top.length ? `${formatCount(schools.top[0].people)} 人${schools.top.length > 1 ? '（各）' : ''}` : '暂无数据'}
            />
          </>
        ) : null}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: schools ? 'repeat(auto-fit, minmax(380px, 1fr))' : '1fr',
          gap: 16,
          marginTop: 16,
          alignItems: 'stretch',
        }}
      >
        <ChartCard<EventStat>
          title="各组别人数"
          subtitle="同一人兼报多个组别时每个组别各算 1 人，相加会大于报名人数"
          chart={eventItems.length
            ? <HorizontalBars items={eventItems} series={series} labelWidth={72} ariaLabel={`${group.label}各组别人数`} />
            : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无组别" />}
          columns={[
            { title: '组别', dataIndex: 'label' },
            { title: '人数', dataIndex: 'people', align: 'right', render: (value: number) => formatCount(value) },
            {
              title: '对数 / 队数',
              key: 'units',
              align: 'right',
              render: (_: unknown, row) => (row.pairs !== null ? `${formatCount(row.pairs)} 对` : row.teams !== null ? `${formatCount(row.teams)} 队` : '—'),
            },
          ]}
          rows={group.events}
          rowKey={(row) => row.key}
        />

        {schools ? (
          <ChartCard<SchoolRankItem & { rank: number }>
            title="高校排行"
            subtitle={`共 ${formatCount(schools.count)} 所，按报名人数从多到少`}
            chart={schoolItems.length ? (
              <>
                <HorizontalBars items={schoolItems} series={series} labelWidth={168} ariaLabel={`${group.label}高校报名人数排行`} />
                {ranking.length > SCHOOL_TOP ? (
                  <Button type="link" size="small" onClick={onToggleSchools} style={{ paddingLeft: 0, marginTop: 8 }}>
                    {showAllSchools ? `收起，只看前 ${SCHOOL_TOP} 名` : `展开全部 ${ranking.length} 所`}
                  </Button>
                ) : null}
              </>
            ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无学校数据" />}
            columns={[
              { title: '名次', dataIndex: 'rank', width: 64 },
              {
                title: '学校',
                dataIndex: 'name',
                render: (value: string, row) => (
                  <div>
                    <div>{value}</div>
                    {row.variants.length ? <Typography.Text type="secondary" style={{ fontSize: 12 }}>{variantsText(row)}</Typography.Text> : null}
                  </div>
                ),
              },
              { title: '人数', dataIndex: 'people', align: 'right', width: 80, render: (value: number) => formatCount(value) },
            ]}
            rows={ranking.map((item, index) => ({ ...item, rank: index + 1 }))}
            rowKey={(row) => row.name}
            footer={[
              schools.unspecifiedPeople ? `未填写学校 ${formatCount(schools.unspecifiedPeople)} 人。` : '',
              schools.ignored.length
                ? `已标记为无效、不计入：${schools.ignored.map((item) => `${item.name}（${item.people} 人）`).join('、')}。`
                : '',
            ].filter(Boolean).join(' ') || undefined}
          />
        ) : null}
      </div>
    </Card>
  );
}
