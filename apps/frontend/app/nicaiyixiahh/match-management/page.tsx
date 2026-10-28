'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import dayjs, { type Dayjs } from 'dayjs';
import { io, type Socket } from 'socket.io-client';
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Divider,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  Popconfirm,
  Result,
  Segmented,
  Select,
  Space,
  Spin,
  Table as AntdTable,
  Tag,
  Typography,
  message,
} from 'antd';
import type { TableColumnsType } from 'antd';
import {
  CheckCircleFilled,
  CheckCircleOutlined,
  ClockCircleOutlined,
  EditOutlined,
  ReloadOutlined,
  SearchOutlined,
  StopOutlined,
  TeamOutlined,
  TrophyOutlined,
} from '@ant-design/icons';
import { apiFetch } from '@/lib/api';
import { useCurrentAccess } from '@/lib/use-current-role';

const { Text, Title } = Typography;
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';
const SOCKET_BASE = API_BASE.replace(/\/api\/?$/, '');

type MatchStatusKey = 'PENDING' | 'LIVE' | 'COMPLETED' | 'CANCELLED';

interface TournamentOption {
  id: string;
  name: string;
  edition?: number;
  status?: string;
  startDate?: string;
  endDate?: string;
  isArchived?: boolean;
}

interface SideView {
  id: string;
  name: string;
  teamName?: string | null;
  affiliation?: string | null;
  players?: Array<{ id: string; index: number; name: string; affiliation?: string | null }>;
}

interface GameView {
  gameNo: number;
  side1Score: number;
  side2Score: number;
  winnerSide?: number | null;
}

interface MatchView {
  id: string;
  eventId: string | null;
  teamMatchId: string | null;
  teamCompetitionId: string | null;
  eventType: string;
  eventTypeLabel: string;
  itemTypeLabel: string | null;
  round: string;
  roundNo: number;
  matchNo: number;
  stageKey: string;
  stageLabel: string;
  stageOrder: number;
  scheduledAt: string | null;
  durationMinutes: number;
  status: MatchStatusKey;
  winnerSide: number | null;
  forfeitedSide: number | null;
  forfeitReason: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  venue: { id: string; name: string; isActive: boolean; sortOrder: number } | null;
  referee: { id: string; username: string } | null;
  side1: SideView | null;
  side2: SideView | null;
  team1Name: string | null;
  team2Name: string | null;
  team1Wins: number | null;
  team2Wins: number | null;
  teamMatchStatus: MatchStatusKey | null;
  games: GameView[];
  scoreText: string;
  hasBothSides: boolean;
  isSecondStage: boolean;
}

interface EventSummary {
  id: string;
  type: string;
  typeLabel: string;
  format: string;
  formatLabel: string;
  scoringRule: string;
  scoringMode: string;
  customGamesToWin: number | null;
  groupCount: number | null;
  qualifiersPerGroup: number | null;
  drawPublished: boolean;
  registrationCount: number;
  matchCount: number;
  completedCount: number;
}

interface TeamMatchSummary {
  id: string;
  teamCompetitionId: string;
  round: string;
  roundNo: number;
  matchNo: number;
  stage: string | null;
  status: MatchStatusKey;
  team1Wins: number;
  team2Wins: number;
  winnerTeamId: string | null;
  team1: { id: string; name: string } | null;
  team2: { id: string; name: string } | null;
  groupName: string | null;
  matchIds: string[];
}

interface TeamCompetitionSummary {
  id: string;
  name: string;
  format: string;
  formatLabel: string;
  winThreshold: number;
  scoringRule: string;
  scoringMode: string;
  customGamesToWin: number | null;
  isPublished: boolean;
  items: Array<{ id: string; eventType: string; eventTypeLabel: string; sortOrder: number }>;
  teams: Array<{ id: string; name: string }>;
  matchCount: number;
  completedCount: number;
  teamMatches: TeamMatchSummary[];
}

interface Overview {
  tournament: {
    id: string;
    name: string;
    edition: number;
    subtitle: string | null;
    status: string;
    location: string | null;
    startDate: string;
    endDate: string;
    isPublished: boolean;
    isArchived: boolean;
    approvalStatus: string;
  };
  events: EventSummary[];
  teamCompetitions: TeamCompetitionSummary[];
  matches: MatchView[];
  venues: Array<{ id: string; name: string; isActive: boolean; sortOrder: number }>;
  referees: Array<{ id: string; username: string; refereedMatchesCount: number }>;
  summary: {
    total: number;
    completed: number;
    live: number;
    pending: number;
    cancelled: number;
    unscheduled: number;
  };
}

const STATUS_META: Record<MatchStatusKey, { label: string; color: string }> = {
  PENDING: { label: '未开始', color: 'default' },
  LIVE: { label: '进行中', color: 'green' },
  COMPLETED: { label: '已结束', color: 'blue' },
  CANCELLED: { label: '已取消', color: 'default' },
};

const TOURNAMENT_STATUS_LABELS: Record<string, string> = {
  REGISTRATION_NOT_STARTED: '报名未开始',
  REGISTRATION_OPEN: '报名中',
  REGISTRATION_CLOSED: '报名截止',
  ONGOING: '进行中',
  FINISHED: '已结束',
};

function statusMeta(status: MatchStatusKey) {
  return STATUS_META[status] ?? STATUS_META.PENDING;
}

function formatDateTime(value?: string | null) {
  return value ? dayjs(value).format('MM-DD HH:mm') : '待排时间';
}

function formatFullDateTime(value?: string | null) {
  return value ? dayjs(value).format('YYYY-MM-DD HH:mm') : '待排时间';
}

function sideName(side?: SideView | null) {
  if (!side) return '待定';
  return side.teamName?.trim() || side.name || '待定';
}

function sidePlayers(side?: SideView | null) {
  if (!side || side.teamName) return '';
  const names = side.players?.map((player) => player.name).filter(Boolean).join(' / ') ?? '';
  return names && names !== side.name ? names : '';
}

function matchVersus(match: MatchView) {
  if (match.teamMatchId) {
    return `${match.team1Name ?? '待定'} VS ${match.team2Name ?? '待定'}`;
  }
  return `${sideName(match.side1)} VS ${sideName(match.side2)}`;
}

function scoreDisplay(match: MatchView) {
  if (match.scoreText) return match.scoreText;
  if (match.forfeitedSide !== null) return 'WO';
  if (!match.hasBothSides && match.status === 'COMPLETED') return '轮空';
  return '未记分';
}

function maxGamesFor(match: MatchView, overview: Overview | null) {
  const fallback = Math.max(match.games.length, 1);
  if (!overview) return Math.max(fallback, 3);
  if (match.teamMatchId) {
    const competition = overview.teamCompetitions.find((item) => item.id === match.teamCompetitionId);
    const gamesToWin = competition?.customGamesToWin
      ?? (competition?.scoringRule === 'FIFTEEN_ONE' ? 1 : 2);
    return Math.max(gamesToWin * 2 - 1, fallback);
  }
  const event = overview.events.find((item) => item.id === match.eventId);
  const gamesToWin = event?.customGamesToWin ?? (event?.scoringRule === 'FIFTEEN_ONE' ? 1 : 2);
  return Math.max(gamesToWin * 2 - 1, fallback);
}

function projectLabel(match: MatchView, overview: Overview | null) {
  if (match.teamMatchId) {
    const competition = overview?.teamCompetitions.find((item) => item.id === match.teamCompetitionId);
    return `团体赛 · ${competition?.name ?? '—'}${match.itemTypeLabel ? ` · ${match.itemTypeLabel}` : ''}`;
  }
  const event = overview?.events.find((item) => item.id === match.eventId);
  return event?.typeLabel ?? match.eventTypeLabel;
}

function errorText(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function isFormValidationError(error: unknown) {
  return Boolean(error && typeof error === 'object' && 'errorFields' in error);
}

type StageGroup = {
  key: string;
  label: string;
  order: number;
  matches: MatchView[];
};

function groupByStage(matches: MatchView[]): StageGroup[] {
  const groups = new Map<string, StageGroup>();
  for (const match of matches) {
    const current = groups.get(match.stageKey) ?? {
      key: match.stageKey,
      label: match.stageLabel,
      order: match.stageOrder,
      matches: [],
    };
    current.matches.push(match);
    groups.set(match.stageKey, current);
  }
  return [...groups.values()]
    .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label, 'zh-CN'))
    .map((group) => ({
      ...group,
      matches: [...group.matches].sort((a, b) => a.matchNo - b.matchNo),
    }));
}

export default function MatchManagementPage() {
  const access = useCurrentAccess();
  const { data: session } = useSession();
  const token = session?.user?.accessToken as string | undefined;

  const [tournaments, setTournaments] = useState<TournamentOption[]>([]);
  const [tournamentsLoading, setTournamentsLoading] = useState(true);
  const [selectedTournamentId, setSelectedTournamentId] = useState('');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(false);
  const [projectFilter, setProjectFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [keyword, setKeyword] = useState('');
  const [viewMode, setViewMode] = useState<'bracket' | 'list'>('bracket');
  const [editing, setEditing] = useState<MatchView | null>(null);
  const reloadTimer = useRef<number | null>(null);
  const requestIdRef = useRef(0);

  const loadOverview = useCallback(async (tournamentId = selectedTournamentId) => {
    if (!token || !tournamentId) return;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);
    try {
      const data = await apiFetch<Overview>(
        `/match-management/tournaments/${tournamentId}/overview`,
        { token, cache: 'no-store' },
      );
      if (requestId !== requestIdRef.current) return;
      setOverview(data);
    } catch (error) {
      if (requestId === requestIdRef.current) {
        message.error(errorText(error, '加载对局数据失败'));
      }
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [token, selectedTournamentId]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    apiFetch<TournamentOption[]>('/tournaments', { token, cache: 'no-store' })
      .then((data) => {
        if (!cancelled) setTournaments(data);
      })
      .catch((error) => message.error(errorText(error, '加载赛事失败')))
      .finally(() => {
        if (!cancelled) setTournamentsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (!token || !selectedTournamentId) return;
    const timer = window.setTimeout(() => {
      void loadOverview(selectedTournamentId);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [token, selectedTournamentId, loadOverview]);

  useEffect(() => {
    if (!selectedTournamentId) return;
    const onFocus = () => void loadOverview();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [loadOverview, selectedTournamentId]);

  // 实时联动：裁判端记分、其他后台改分或晋级后，自动刷新当前赛事的对局状态。
  useEffect(() => {
    if (!token || !selectedTournamentId) return;
    const socket: Socket = io(`${SOCKET_BASE}/scores`, {
      transports: ['polling', 'websocket'],
      withCredentials: true,
    });
    const refreshSoon = (payload?: {
      tournamentId?: string | null;
      event?: { tournament?: { id?: string } | null } | null;
    }) => {
      const tournamentId = payload?.tournamentId ?? payload?.event?.tournament?.id ?? null;
      // 忽略无法识别赛事的广播，避免其他赛事的每一次得分都触发刷新。
      if (!tournamentId || tournamentId !== selectedTournamentId) return;
      if (reloadTimer.current) window.clearTimeout(reloadTimer.current);
      reloadTimer.current = window.setTimeout(() => {
        void loadOverview();
      }, 1500);
    };
    socket.on('bracket:update', refreshSoon);
    socket.on('scoreboard:update', refreshSoon);
    return () => {
      socket.off('bracket:update', refreshSoon);
      socket.off('scoreboard:update', refreshSoon);
      socket.disconnect();
      if (reloadTimer.current) window.clearTimeout(reloadTimer.current);
      reloadTimer.current = null;
    };
  }, [token, selectedTournamentId, loadOverview]);

  const selectedTournament = useMemo(
    () => tournaments.find((item) => item.id === selectedTournamentId),
    [selectedTournamentId, tournaments],
  );

  const projectOptions = useMemo(() => {
    if (!overview) return [{ value: 'ALL', label: '全部项目' }];
    return [
      { value: 'ALL', label: '全部项目' },
      ...overview.events.map((event) => ({
        value: `E:${event.id}`,
        label: `单项 · ${event.typeLabel}`,
      })),
      ...overview.teamCompetitions.map((competition) => ({
        value: `T:${competition.id}`,
        label: `团体 · ${competition.name}`,
      })),
    ];
  }, [overview]);

  const visibleMatches = useMemo(() => {
    if (!overview) return [];
    const search = keyword.trim().toLowerCase();
    return overview.matches
      .filter((match) => {
        if (projectFilter.startsWith('E:') && match.eventId !== projectFilter.slice(2)) return false;
        if (projectFilter.startsWith('T:') && match.teamCompetitionId !== projectFilter.slice(2)) return false;
        if (statusFilter !== 'ALL' && match.status !== statusFilter) return false;
        if (search) {
          const haystack = [
            sideName(match.side1),
            sideName(match.side2),
            sidePlayers(match.side1),
            sidePlayers(match.side2),
            match.team1Name,
            match.team2Name,
            match.referee?.username,
            match.venue?.name,
            match.stageLabel,
            match.itemTypeLabel,
            match.eventTypeLabel,
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
          if (!haystack.includes(search)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const aTime = a.scheduledAt ? new Date(a.scheduledAt).getTime() : Number.MAX_SAFE_INTEGER;
        const bTime = b.scheduledAt ? new Date(b.scheduledAt).getTime() : Number.MAX_SAFE_INTEGER;
        return aTime - bTime || a.stageOrder - b.stageOrder || a.matchNo - b.matchNo;
      });
  }, [overview, projectFilter, statusFilter, keyword]);

  const handleTournamentChange = useCallback((value: string) => {
    requestIdRef.current += 1;
    setSelectedTournamentId(value);
    setOverview(null);
    setEditing(null);
    setProjectFilter('ALL');
    setStatusFilter('ALL');
    setKeyword('');
  }, []);

  const handleSaved = useCallback(async () => {
    setEditing(null);
    await loadOverview();
  }, [loadOverview]);

  if (!access.ready) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', minHeight: 320 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (access.role !== 'ROOT') {
    return (
      <Result
        status="403"
        title="无权访问"
        subTitle="裁判员对局管理仅超级管理员可用，其他角色不显示该入口。"
      />
    );
  }

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
          <Title level={3} style={{ margin: 0 }}>裁判员对局管理</Title>
          <Text type="secondary">
            先选择赛事，再按项目查看完整对阵表、比赛时间、比分和结束状态；所有修改仅超级管理员可执行，并会实时联动公开赛程、现场大屏与裁判端。
          </Text>
        </div>
        <Space wrap>
          <Tag color="red">超级管理员专属</Tag>
          <Button
            href={selectedTournamentId ? `/competitions/${selectedTournamentId}/brackets` : undefined}
            target="_blank"
            disabled={!selectedTournamentId}
          >
            公开签表
          </Button>
          <Button
            href={selectedTournamentId ? `/live-screen/${selectedTournamentId}` : undefined}
            target="_blank"
            disabled={!selectedTournamentId}
          >
            现场大屏
          </Button>
          <Button
            icon={<ReloadOutlined />}
            onClick={() => void loadOverview()}
            loading={loading}
            disabled={!selectedTournamentId}
          >
            刷新
          </Button>
        </Space>
      </div>

      <Card style={{ marginTop: 16 }}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <Space wrap align="center">
            <Text strong>选择赛事</Text>
            <Select
              style={{ width: 'min(420px, 72vw)' }}
              placeholder="请选择赛事"
              value={selectedTournamentId || undefined}
              options={tournaments.map((item) => ({
                value: item.id,
                label: item.name,
              }))}
              onChange={handleTournamentChange}
              loading={tournamentsLoading}
              showSearch
              optionFilterProp="label"
            />
            {selectedTournament?.isArchived ? <Tag>已归档</Tag> : null}
            {overview ? (
              <Tag color="blue">
                {TOURNAMENT_STATUS_LABELS[overview.tournament.status] ?? overview.tournament.status}
              </Tag>
            ) : null}
          </Space>
          {overview ? (
            <Space wrap size={16} style={{ marginLeft: 'auto' }}>
              <Text type="secondary">
                <TrophyOutlined /> 单项 {overview.events.length} 个
              </Text>
              <Text type="secondary">
                <TeamOutlined /> 团体赛 {overview.teamCompetitions.length} 个
              </Text>
              <Text type="secondary">
                {dayjs(overview.tournament.startDate).format('YYYY-MM-DD')} ~ {dayjs(overview.tournament.endDate).format('YYYY-MM-DD')}
              </Text>
              {overview.tournament.location ? (
                <Text type="secondary">{overview.tournament.location}</Text>
              ) : null}
            </Space>
          ) : null}
        </div>
      </Card>

      {!selectedTournamentId ? (
        <Card style={{ marginTop: 16 }}>
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="请先选择赛事，随后查看该赛事的对阵表、时间、比分与结束状态"
          />
        </Card>
      ) : loading && !overview ? (
        <div style={{ padding: 64, textAlign: 'center' }}>
          <Spin size="large" />
        </div>
      ) : !overview ? (
        <Card style={{ marginTop: 16 }}>
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂未加载到该赛事的数据" />
        </Card>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <MetricCard title="总场次" value={overview.summary.total} />
            <MetricCard title="已结束" value={overview.summary.completed} accent="#2563eb" />
            <MetricCard title="进行中" value={overview.summary.live} accent="#dc2626" />
            <MetricCard title="未开始" value={overview.summary.pending} accent="#d97706" />
            <MetricCard title="待排时间" value={overview.summary.unscheduled} accent="#7c3aed" />
            <MetricCard title="当前筛选" value={visibleMatches.length} accent="#0f766e" />
          </div>

          <Card style={{ marginTop: 16 }}>
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <Space wrap>
                <Select
                  style={{ width: 220 }}
                  value={projectFilter}
                  options={projectOptions}
                  onChange={setProjectFilter}
                />
                <Select
                  style={{ width: 140 }}
                  value={statusFilter}
                  options={[
                    { value: 'ALL', label: '全部状态' },
                    { value: 'PENDING', label: '未开始' },
                    { value: 'LIVE', label: '进行中' },
                    { value: 'COMPLETED', label: '已结束' },
                    { value: 'CANCELLED', label: '已取消' },
                  ]}
                  onChange={setStatusFilter}
                />
                <Input
                  allowClear
                  prefix={<SearchOutlined />}
                  placeholder="搜索选手 / 队伍 / 裁判 / 场地"
                  style={{ width: 260 }}
                  value={keyword}
                  onChange={(event) => setKeyword(event.target.value)}
                />
              </Space>
              <Space wrap>
                <Text type="secondary">
                  显示 {visibleMatches.length} / {overview.matches.length} 场
                </Text>
                <Segmented
                  value={viewMode}
                  onChange={(value) => setViewMode(value as 'bracket' | 'list')}
                  options={[
                    { value: 'bracket', label: '对阵表' },
                    { value: 'list', label: '列表' },
                  ]}
                />
              </Space>
            </div>
          </Card>

          {!overview.matches.length ? (
            <Card style={{ marginTop: 16 }}>
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="该赛事暂无对局，请先完成抽签编排或团体对阵生成"
              />
            </Card>
          ) : !visibleMatches.length ? (
            <Card style={{ marginTop: 16 }}>
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有符合筛选条件的对局" />
            </Card>
          ) : viewMode === 'bracket' ? (
            <div style={{ marginTop: 16 }}>
              <BracketSections
                overview={overview}
                matches={visibleMatches}
                onEdit={setEditing}
              />
            </div>
          ) : (
            <Card style={{ marginTop: 16 }}>
              <MatchTable
                overview={overview}
                matches={visibleMatches}
                onEdit={setEditing}
              />
            </Card>
          )}
        </>
      )}

      <MatchManageDrawer
        key={editing?.id ?? 'closed'}
        match={editing}
        overview={overview}
        token={token}
        onClose={() => setEditing(null)}
        onSaved={handleSaved}
      />
    </div>
  );
}

function MetricCard({ title, value, accent }: { title: string; value: number; accent?: string }) {
  return (
    <Card size="small" styles={{ body: { padding: '12px 14px' } }}>
      <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>{title}</div>
      <div style={{ marginTop: 4, fontSize: 26, lineHeight: 1.15, fontWeight: 800, color: accent ?? '#0f172a' }}>
        {value}
      </div>
    </Card>
  );
}

function BracketSections({
  overview,
  matches,
  onEdit,
}: {
  overview: Overview;
  matches: MatchView[];
  onEdit: (match: MatchView) => void;
}) {
  const sections: React.ReactNode[] = [];

  for (const event of overview.events) {
    const eventMatches = matches.filter((match) => match.eventId === event.id);
    if (!eventMatches.length) continue;
    sections.push(
      <Card
        key={`event-${event.id}`}
        size="small"
        style={{ marginBottom: 16 }}
        title={
          <Space wrap size={8}>
            <Tag color="blue" style={{ marginInlineEnd: 0 }}>{event.typeLabel}</Tag>
            <Text>{event.formatLabel}</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {event.matchCount} 场 · 已结束 {event.completedCount}
            </Text>
          </Space>
        }
      >
        <StageBoard matches={eventMatches} onEdit={onEdit} />
      </Card>,
    );
  }

  for (const competition of overview.teamCompetitions) {
    const competitionMatches = matches.filter(
      (match) => match.teamCompetitionId === competition.id,
    );
    if (!competitionMatches.length) continue;
    sections.push(
      <TeamBoard
        key={`team-${competition.id}`}
        competition={competition}
        matches={competitionMatches}
        onEdit={onEdit}
      />,
    );
  }

  return <>{sections}</>;
}

function StageBoard({
  matches,
  onEdit,
}: {
  matches: MatchView[];
  onEdit: (match: MatchView) => void;
}) {
  const stages = useMemo(() => groupByStage(matches), [matches]);
  return (
    <div
      style={{
        display: 'grid',
        gridAutoFlow: 'column',
        gridAutoColumns: 'minmax(278px, 1fr)',
        gap: 12,
        overflowX: 'auto',
        paddingBottom: 4,
      }}
    >
      {stages.map((stage) => {
        const completed = stage.matches.filter((match) => match.status === 'COMPLETED').length;
        return (
          <div key={stage.key} style={{ minWidth: 0 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                marginBottom: 8,
                padding: '6px 10px',
                borderRadius: 8,
                background: '#f1f5fd',
                border: '1px solid #dbe7fb',
              }}
            >
              <Text strong style={{ color: '#03205c' }}>{stage.label}</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>{completed}/{stage.matches.length}</Text>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {stage.matches.map((match) => (
                <MatchCard key={match.id} match={match} onEdit={onEdit} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MatchCard({ match, onEdit }: { match: MatchView; onEdit: (match: MatchView) => void }) {
  const meta = statusMeta(match.status);
  const live = match.status === 'LIVE';
  const secondLine = sidePlayers(match.side1);
  const thirdLine = sidePlayers(match.side2);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onEdit(match)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onEdit(match);
        }
      }}
      style={{
        cursor: 'pointer',
        borderRadius: 10,
        border: `1px solid ${live ? '#fca5a5' : '#e2e8f0'}`,
        background: live ? '#fff7f6' : '#fff',
        padding: '10px 12px',
        boxShadow: '0 1px 2px rgba(15, 42, 90, .05)',
        transition: 'box-shadow .15s ease, transform .15s ease',
      }}
      title="点击管理本场"
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <Text strong style={{ fontSize: 12, color: '#475569' }}>第 {match.matchNo} 场</Text>
        <Tag color={meta.color} style={{ marginInlineEnd: 0 }}>{meta.label}</Tag>
      </div>

      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <SideLine name={sideName(match.side1)} sub={secondLine} winner={match.winnerSide === 1} />
        <SideLine name={sideName(match.side2)} sub={thirdLine} winner={match.winnerSide === 2} />
      </div>

      <div style={{ marginTop: 8, display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <Text strong style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 16 }}>
          {scoreDisplay(match)}
        </Text>
        {match.forfeitedSide !== null ? <Tag color="red">弃权/退赛</Tag> : null}
      </div>

      <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: '3px 10px' }}>
        <Text type="secondary" style={{ fontSize: 11 }}>
          <ClockCircleOutlined /> {formatDateTime(match.scheduledAt)}
        </Text>
        <Text type="secondary" style={{ fontSize: 11 }}>场地 {match.venue?.name ?? '待定'}</Text>
        <Text type="secondary" style={{ fontSize: 11 }}>裁判 {match.referee?.username ?? '未分配'}</Text>
      </div>
    </div>
  );
}

function SideLine({ name, sub, winner }: { name: string; sub?: string; winner: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        <span style={{ fontWeight: winner ? 800 : 600, color: winner ? '#03205c' : '#334155' }}>{name}</span>
        {sub ? <span style={{ marginLeft: 6, fontSize: 11, color: '#94a3b8' }}>{sub}</span> : null}
      </span>
      {winner ? <CheckCircleFilled style={{ color: '#f59e0b', flexShrink: 0 }} /> : null}
    </div>
  );
}

function TeamBoard({
  competition,
  matches,
  onEdit,
}: {
  competition: TeamCompetitionSummary;
  matches: MatchView[];
  onEdit: (match: MatchView) => void;
}) {
  const encounters = competition.teamMatches
    .map((encounter) => ({
      ...encounter,
      children: matches.filter((match) => match.teamMatchId === encounter.id),
    }))
    .filter((encounter) => encounter.children.length > 0);

  return (
    <Card
      size="small"
      style={{ marginBottom: 16 }}
      title={
        <Space wrap size={8}>
          <Tag color="purple" style={{ marginInlineEnd: 0 }}>团体赛</Tag>
          <Text>{competition.name}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {competition.formatLabel} · {competition.matchCount} 个子项 · 已结束 {competition.completedCount}
          </Text>
        </Space>
      }
    >
      <div className="grid gap-3 xl:grid-cols-2">
        {encounters.map((encounter) => {
          const meta = statusMeta(encounter.status);
          return (
            <div
              key={encounter.id}
              style={{
                border: '1px solid #e2e8f0',
                borderRadius: 10,
                overflow: 'hidden',
                background: '#fff',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  padding: '9px 12px',
                  background: '#f8fafc',
                  borderBottom: '1px solid #eef2f7',
                  flexWrap: 'wrap',
                }}
              >
                <Space wrap size={6}>
                  <Text strong>{encounter.team1?.name ?? '待定'}</Text>
                  <Text strong style={{ color: '#0f4c9c' }}>
                    {encounter.team1Wins} : {encounter.team2Wins}
                  </Text>
                  <Text strong>{encounter.team2?.name ?? '待定'}</Text>
                </Space>
                <Space wrap size={6}>
                  <Tag color={meta.color} style={{ marginInlineEnd: 0 }}>{meta.label}</Tag>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {encounter.groupName ? `${encounter.groupName} · ` : ''}
                    {encounter.round || `第 ${encounter.roundNo} 轮`} 第 {encounter.matchNo} 场
                  </Text>
                </Space>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {encounter.children.map((match, index) => {
                  const childMeta = statusMeta(match.status);
                  return (
                    <button
                      key={match.id}
                      type="button"
                      onClick={() => onEdit(match)}
                      style={{
                        textAlign: 'left',
                        border: 'none',
                        borderTop: index === 0 ? 'none' : '1px solid #f1f5f9',
                        background: 'transparent',
                        padding: '9px 12px',
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                        <Text strong style={{ fontSize: 12 }}>
                          {match.itemTypeLabel ?? '子项'} · 第 {match.matchNo} 项
                        </Text>
                        <Tag color={childMeta.color} style={{ marginInlineEnd: 0 }}>{childMeta.label}</Tag>
                      </div>
                      <div style={{ marginTop: 4, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                        <Text style={{ fontSize: 13 }}>
                          {sideName(match.side1)} <Text type="secondary">vs</Text> {sideName(match.side2)}
                        </Text>
                        <Text strong style={{ fontFamily: 'ui-monospace, monospace' }}>
                          {scoreDisplay(match)}
                        </Text>
                      </div>
                      <div style={{ marginTop: 3, display: 'flex', flexWrap: 'wrap', gap: '2px 10px' }}>
                        <Text type="secondary" style={{ fontSize: 11 }}>
                          {formatDateTime(match.scheduledAt)}
                        </Text>
                        <Text type="secondary" style={{ fontSize: 11 }}>
                          场地 {match.venue?.name ?? '待定'}
                        </Text>
                        <Text type="secondary" style={{ fontSize: 11 }}>
                          裁判 {match.referee?.username ?? '未分配'}
                        </Text>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function MatchTable({
  overview,
  matches,
  onEdit,
}: {
  overview: Overview;
  matches: MatchView[];
  onEdit: (match: MatchView) => void;
}) {
  const columns: TableColumnsType<MatchView> = [
    {
      title: '时间',
      width: 120,
      render: (_, match) => <Text style={{ fontSize: 12 }}>{formatFullDateTime(match.scheduledAt)}</Text>,
    },
    {
      title: '项目',
      width: 230,
      render: (_, match) => <Text style={{ fontSize: 12 }}>{projectLabel(match, overview)}</Text>,
    },
    {
      title: '阶段',
      width: 110,
      render: (_, match) => <Text style={{ fontSize: 12 }}>{match.stageLabel}</Text>,
    },
    {
      title: '场次',
      width: 76,
      render: (_, match) => `第 ${match.matchNo} 场`,
    },
    {
      title: '对阵',
      width: 260,
      render: (_, match) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Text style={{ fontSize: 12 }}>{matchVersus(match)}</Text>
          {match.teamMatchId ? (
            <Text type="secondary" style={{ fontSize: 11 }}>
              {sideName(match.side1)} vs {sideName(match.side2)}
            </Text>
          ) : null}
        </div>
      ),
    },
    {
      title: '比分',
      width: 130,
      render: (_, match) => (
        <Text strong style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>
          {scoreDisplay(match)}
        </Text>
      ),
    },
    {
      title: '状态',
      width: 88,
      render: (_, match) => {
        const meta = statusMeta(match.status);
        return <Tag color={meta.color}>{meta.label}</Tag>;
      },
    },
    {
      title: '场地',
      width: 90,
      render: (_, match) => match.venue?.name ?? '—',
    },
    {
      title: '裁判',
      width: 110,
      render: (_, match) => match.referee?.username ?? '未分配',
    },
    {
      title: '操作',
      width: 86,
      fixed: 'right',
      render: (_, match) => (
        <Button size="small" icon={<EditOutlined />} onClick={() => onEdit(match)}>
          管理
        </Button>
      ),
    },
  ];

  return (
    <AntdTable
      rowKey="id"
      dataSource={matches}
      columns={columns}
      size="small"
      scroll={{ x: 1500 }}
      pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (total) => `共 ${total} 场` }}
    />
  );
}

function MatchManageDrawer({
  match,
  overview,
  token,
  onClose,
  onSaved,
}: {
  match: MatchView | null;
  overview: Overview | null;
  token?: string;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const [form] = Form.useForm();
  const [games, setGames] = useState<GameView[]>(() => {
    if (!match) return [];
    const existing = new Map(match.games.map((game) => [game.gameNo, game]));
    return Array.from({ length: maxGamesFor(match, overview) }, (_, index) => {
      const gameNo = index + 1;
      return existing.get(gameNo) ?? { gameNo, side1Score: 0, side2Score: 0, winnerSide: null };
    });
  });
  const [savingBasic, setSavingBasic] = useState(false);
  const [savingScore, setSavingScore] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);

  // Drawer 由父组件用 match.id 作为 key，切换场次时自然重建表单与比分输入。
  const initialValues = {
    scheduledAt: match?.scheduledAt ? dayjs(match.scheduledAt) : null,
    venueId: match?.venue?.id ?? null,
    durationMinutes: match?.durationMinutes ?? 45,
    refereeId: match?.referee?.id ?? null,
  };

  async function saveBasic() {
    if (!token || !match) return;
    let values: {
      scheduledAt?: Dayjs | null;
      venueId?: string | null;
      durationMinutes?: number;
      refereeId?: string | null;
    };
    try {
      values = await form.validateFields();
    } catch (error) {
      if (isFormValidationError(error)) return;
      message.error(errorText(error, '表单校验失败'));
      return;
    }

    const payload: Record<string, unknown> = {};
    const nextScheduledAt = values.scheduledAt ? values.scheduledAt.toISOString() : null;
    const currentScheduledAt = match.scheduledAt ? dayjs(match.scheduledAt).toISOString() : null;
    if (nextScheduledAt !== currentScheduledAt) payload.scheduledAt = nextScheduledAt;
    if ((values.venueId ?? null) !== (match.venue?.id ?? null)) payload.venueId = values.venueId || null;
    if (values.durationMinutes !== match.durationMinutes) payload.durationMinutes = values.durationMinutes;
    if ((values.refereeId ?? null) !== (match.referee?.id ?? null)) payload.refereeId = values.refereeId || null;

    if (!Object.keys(payload).length) {
      message.info('没有需要保存的修改');
      return;
    }

    setSavingBasic(true);
    try {
      await apiFetch(`/match-management/matches/${match.id}`, {
        method: 'PATCH',
        token,
        body: JSON.stringify(payload),
      });
      message.success('已保存，赛程、现场大屏与裁判端已联动更新');
      await onSaved();
    } catch (error) {
      message.error(errorText(error, '保存失败'));
    } finally {
      setSavingBasic(false);
    }
  }

  async function saveScore() {
    if (!token || !match) return;
    setSavingScore(true);
    try {
      await apiFetch(`/match-management/matches/${match.id}/score`, {
        method: 'PATCH',
        token,
        body: JSON.stringify({
          games: games.map(({ side1Score, side2Score }) => ({ side1Score, side2Score })),
        }),
      });
      message.success('比分已更新，胜负、晋级与团体总分已联动');
      await onSaved();
    } catch (error) {
      message.error(errorText(error, '更新比分失败'));
    } finally {
      setSavingScore(false);
    }
  }

  async function completeMatch() {
    if (!token || !match) return;
    setStatusBusy(true);
    try {
      await apiFetch(`/match-management/matches/${match.id}/complete`, { method: 'POST', token });
      message.success('已结束本场，晋级对阵与团体比分已同步');
      await onSaved();
    } catch (error) {
      message.error(errorText(error, '结束本场失败'));
    } finally {
      setStatusBusy(false);
    }
  }

  async function reopenMatch() {
    if (!token || !match) return;
    setStatusBusy(true);
    try {
      await apiFetch(`/match-management/matches/${match.id}/reopen`, { method: 'POST', token });
      message.success('已重开本场，可修改比分后重新结束');
      await onSaved();
    } catch (error) {
      message.error(errorText(error, '重开本场失败'));
    } finally {
      setStatusBusy(false);
    }
  }

  const meta = match ? statusMeta(match.status) : STATUS_META.PENDING;
  const canComplete = Boolean(
    match
    && match.status !== 'COMPLETED'
    && match.status !== 'CANCELLED'
    && match.hasBothSides
    && match.teamMatchStatus !== 'COMPLETED'
    && (match.winnerSide === 1 || match.winnerSide === 2),
  );
  const canReopen = Boolean(
    match
    && match.status === 'COMPLETED'
    && match.hasBothSides
    && match.forfeitedSide === null
    && !match.isSecondStage
    && match.teamMatchStatus !== 'COMPLETED',
  );

  return (
    <Drawer
      title={
        match
          ? match.teamMatchId
            ? `管理对局 · ${match.itemTypeLabel ?? '团体子项'}`
            : `管理对局 · 第 ${match.matchNo} 场`
          : '管理对局'
      }
      open={Boolean(match)}
      onClose={onClose}
      size="min(640px, 100vw)"
      destroyOnHidden
      extra={<Tag color="red">超级管理员</Tag>}
    >
      {match && overview ? (
        <div>
          <div
            style={{
              borderRadius: 10,
              border: '1px solid #e2e8f0',
              background: '#f8fafc',
              padding: '12px 14px',
            }}
          >
            <Text type="secondary" style={{ fontSize: 12 }}>
              {projectLabel(match, overview)} · {match.stageLabel}
            </Text>
            <div style={{ marginTop: 6, fontSize: 18, fontWeight: 800, color: '#03205c' }}>
              {matchVersus(match)}
            </div>
            {match.teamMatchId ? (
              <Text type="secondary" style={{ display: 'block', marginTop: 2, fontSize: 12 }}>
                {sideName(match.side1)} vs {sideName(match.side2)}
              </Text>
            ) : null}
            <Space wrap size={8} style={{ marginTop: 8 }}>
              <Tag color={meta.color} style={{ marginInlineEnd: 0 }}>{meta.label}</Tag>
              <Text strong style={{ fontFamily: 'ui-monospace, monospace' }}>
                {scoreDisplay(match)}
              </Text>
              {match.winnerSide ? <Text type="secondary">胜方：{sideName(match.winnerSide === 1 ? match.side1 : match.side2)}</Text> : null}
            </Space>
          </div>

          <Divider titlePlacement="left" style={{ margin: '18px 0 12px' }}>时间 / 场地 / 裁判</Divider>
          <Form form={form} layout="vertical" requiredMark={false} initialValues={initialValues}>
            <Form.Item name="scheduledAt" label="比赛时间">
              <DatePicker
                showTime={{ format: 'HH:mm' }}
                format="YYYY-MM-DD HH:mm"
                style={{ width: '100%' }}
                allowClear
                placeholder="待排时间"
              />
            </Form.Item>
            <div className="grid gap-3 sm:grid-cols-2">
              <Form.Item name="venueId" label="比赛场地">
                <Select
                  allowClear
                  placeholder="待排场地"
                  options={(overview.venues ?? []).map((venue) => ({
                    value: venue.id,
                    label: `${venue.name}${venue.isActive ? '' : '（停用）'}`,
                    disabled: !venue.isActive,
                  }))}
                />
              </Form.Item>
              <Form.Item
                name="durationMinutes"
                label="预估时长（分钟）"
                rules={[{ required: true, message: '请输入预估时长' }]}
              >
                <InputNumber min={1} max={600} precision={0} style={{ width: '100%' }} />
              </Form.Item>
            </div>
            <Form.Item name="refereeId" label="执裁裁判">
              <Select
                allowClear
                showSearch
                optionFilterProp="label"
                placeholder="未分配"
                options={overview.referees.map((referee) => ({
                  value: referee.id,
                  label: `${referee.username}（已裁 ${referee.refereedMatchesCount} 场）`,
                }))}
              />
            </Form.Item>
            {match.teamMatchId ? (
              <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 12 }}
                message="团体赛子项联动"
                description="修改时间或场地后，本场团体对阵的未开始子项会按顺序整场顺延，并同步到裁判端。"
              />
            ) : null}
            <Text type="secondary" style={{ display: 'block', marginBottom: 12, fontSize: 12 }}>
              时间与场地修改会立即生效，系统不会自动重排其他场次；如需整体冲突检测，请到“场地排程”处理。
            </Text>
            <Button type="primary" onClick={() => void saveBasic()} loading={savingBasic}>
              保存时间 / 场地 / 裁判
            </Button>
          </Form>

          <Divider titlePlacement="left" style={{ margin: '22px 0 12px' }}>比分</Divider>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {games.map((game) => (
              <div
                key={game.gameNo}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '64px 1fr 18px 1fr',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <Text>第 {game.gameNo} 局</Text>
                <InputNumber
                  min={0}
                  max={999}
                  precision={0}
                  value={game.side1Score}
                  onChange={(value) => setGames((current) => current.map((item) => (
                    item.gameNo === game.gameNo
                      ? { ...item, side1Score: Math.max(0, Math.trunc(value ?? 0)) }
                      : item
                  )))}
                  style={{ width: '100%' }}
                />
                <span style={{ textAlign: 'center', fontWeight: 800, color: '#94a3b8' }}>:</span>
                <InputNumber
                  min={0}
                  max={999}
                  precision={0}
                  value={game.side2Score}
                  onChange={(value) => setGames((current) => current.map((item) => (
                    item.gameNo === game.gameNo
                      ? { ...item, side2Score: Math.max(0, Math.trunc(value ?? 0)) }
                      : item
                  )))}
                  style={{ width: '100%' }}
                />
              </div>
            ))}
          </div>
          <Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
            保存后会按本场计分规则重新判定每局与整场胜负；未进行的后续局请保持 0:0。
            {match.status === 'COMPLETED' ? ' 已结束场次只能更正比分，不能改变胜方；如需改判请先重开本场。' : ''}
          </Text>
          <Button
            style={{ marginTop: 12 }}
            type="primary"
            ghost
            onClick={() => void saveScore()}
            loading={savingScore}
            disabled={!match.hasBothSides || match.forfeitedSide !== null || match.status === 'CANCELLED'}
          >
            保存比分
          </Button>
          {!match.hasBothSides ? (
            <Text type="secondary" style={{ display: 'block', marginTop: 6, fontSize: 12 }}>
              对阵双方尚未确定（轮空或等待晋级），暂不能录入比分。
            </Text>
          ) : null}

          <Divider titlePlacement="left" style={{ margin: '22px 0 12px' }}>结束状态</Divider>
          <Space direction="vertical" size={10} style={{ width: '100%' }}>
            <Alert
              type={match.forfeitedSide !== null ? 'warning' : 'info'}
              showIcon
              message={`当前状态：${meta.label}`}
              description={
                match.forfeitedSide !== null
                  ? `本场由弃权/退赛判定：${match.forfeitReason ?? '未填写原因'}。此类赛果不能在此重开。`
                  : match.status === 'COMPLETED'
                    ? '本场已结束。可以更正比分，或重开后改分并重新结束。'
                    : match.status === 'CANCELLED'
                      ? '本场已取消，不能在此修改赛果。'
                      : match.status === 'LIVE'
                        ? '比赛进行中。已决出胜方时可直接结束；否则请先补录比分。'
                        : '比赛尚未开始。录入能判定胜负的比分后，系统会自动结束并推进晋级。'
              }
            />
            {canComplete ? (
              <Popconfirm
                title="结束本场？"
                description="将按当前比分确认胜方并推进晋级；如后续场次已开赛，请先处理后续场次。"
                okText="确认结束"
                cancelText="取消"
                onConfirm={() => void completeMatch()}
              >
                <Button type="primary" icon={<CheckCircleOutlined />} loading={statusBusy}>
                  结束本场并推进晋级
                </Button>
              </Popconfirm>
            ) : null}
            {canReopen ? (
              <Popconfirm
                title="重开本场？"
                description="会清除本场胜方并撤销已推进到下一轮的签位；若后续轮次或团体后续子项已开赛，将被拒绝。"
                okText="确认重开"
                cancelText="取消"
                onConfirm={() => void reopenMatch()}
              >
                <Button danger icon={<StopOutlined />} loading={statusBusy}>
                  重开本场（改分后重新结束）
                </Button>
              </Popconfirm>
            ) : null}
            {match.isSecondStage && match.status === 'COMPLETED' ? (
              <Text type="secondary" style={{ fontSize: 12 }}>
                第二阶段场次的赛果需在第二阶段编排中调整，这里仅支持修改时间、场地、裁判与比分。
              </Text>
            ) : null}
            <Text type="secondary" style={{ fontSize: 12 }}>
              结束 / 重开会实时推送到公开对阵表、现场大屏与裁判端；其他裁判正在记分时请先确认现场状态。
            </Text>
          </Space>
        </div>
      ) : null}
    </Drawer>
  );
}
