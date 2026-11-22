'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSession } from 'next-auth/react';
import dayjs, { type Dayjs } from 'dayjs';
import { io, type Socket } from 'socket.io-client';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Collapse,
  DatePicker,
  Drawer,
  Empty,
  Form,
  InputNumber,
  Modal,
  Popconfirm,
  Result,
  Segmented,
  Select,
  Space,
  Spin,
  Tabs,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  CheckCircleOutlined,
  ReloadOutlined,
  SearchOutlined,
  StopOutlined,
  TeamOutlined,
  TrophyOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons';
import { apiFetch } from '@/lib/api';
import { useCurrentAccess } from '@/lib/use-current-role';
import {
  DEFAULT_ALL_QUERY,
  EMPTY_FILTERS,
  NONE,
  buildCourtBoard,
  compareMatches,
  filterMatches,
  matchAttention,
  matchDateKey,
  pickInitialTournament,
  statusTabCounts,
  type AllMatchesQuery,
  type MatchFilters,
  type MMAllMatch,
  type MMTournament,
} from '@/lib/match-management';
import { TournamentDirectory, TournamentPicker, TournamentStatusTag } from '@/components/admin/match-management/TournamentChooser';
import { MatchToolbar, type ViewMode } from '@/components/admin/match-management/MatchToolbar';
import { CourtBoard } from '@/components/admin/match-management/CourtBoard';
import { MatchList } from '@/components/admin/match-management/MatchList';
import { MatchLogs } from '@/components/admin/match-management/MatchLogs';
import { GlobalMatchSearch } from '@/components/admin/match-management/GlobalMatchSearch';
import { AllMatchesView } from '@/components/admin/match-management/AllMatchesView';
import { AttentionTags, SideName, StatusTag, scoreText } from '@/components/admin/match-management/display';

const { Text, Title } = Typography;
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';
const SOCKET_BASE = API_BASE.replace(/\/api\/?$/, '');
const STORAGE_TOURNAMENT = 'match-management:tournament';
const STORAGE_VIEW = 'match-management:view';

type MatchStatusKey = 'PENDING' | 'LIVE' | 'COMPLETED' | 'CANCELLED';

/** 全部场次（打开页面默认）/ 按赛事。 */
type PageMode = 'all' | 'tournament';

/** 解除裁判时确认框要用的字段（全部场次的列表项也有这些）。 */
type ReleaseTarget = Pick<MatchView, 'id' | 'status' | 'referee' | 'scoreText' | 'forfeitedSide' | 'hasBothSides'>;

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
  /** 场次号，和秩序册一致（男单12、团体3）；没排时间场地的没有。 */
  code?: string | null;
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
  gamesToWin?: number;
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
  /** 可以指派的裁判：管理员只看到自己名下的，超级管理员看全部。 */
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

const STATUS_LABELS: Record<MatchStatusKey, string> = {
  PENDING: '未开始',
  LIVE: '进行中',
  COMPLETED: '已结束',
  CANCELLED: '已取消',
};

function sideName(side?: SideView | null) {
  if (!side) return '待定';
  return side.teamName?.trim() || side.name || '待定';
}

function matchVersus(match: MatchView) {
  if (match.teamMatchId) {
    return `${match.team1Name ?? '待定'} VS ${match.team2Name ?? '待定'}`;
  }
  return `${sideName(match.side1)} VS ${sideName(match.side2)}`;
}

function maxGamesFor(match: MatchView, overview: Overview | null) {
  const fallback = Math.max(match.games.length, 1);
  // 后端按该场所处阶段解析出的实际规则（含分阶段计分）；旧接口没有该字段时按默认规则推算
  if (typeof match.gamesToWin === 'number') return Math.max(match.gamesToWin * 2 - 1, fallback);
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
    return `团体 · ${competition?.name ?? '—'}${match.itemTypeLabel ? ` · ${match.itemTypeLabel}` : ''}`;
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

function readStorage(key: string) {
  try {
    return typeof window === 'undefined' ? null : window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // 隐私模式等存不了就算了
  }
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
    .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label, 'zh-CN', { numeric: true }))
    .map((group) => ({
      ...group,
      matches: [...group.matches].sort((a, b) => a.matchNo - b.matchNo),
    }));
}

export default function MatchManagementPage() {
  const access = useCurrentAccess();
  const { data: session } = useSession();
  const token = session?.user?.accessToken as string | undefined;
  const canUse = access.can('MATCH_MANAGEMENT');
  const isRoot = access.role === 'ROOT';

  const [tournaments, setTournaments] = useState<MMTournament[]>([]);
  const [tournamentsLoading, setTournamentsLoading] = useState(true);
  const [selectedTournamentId, setSelectedTournamentId] = useState<string | null>(null);
  // 打开页面默认「全部场次」；按赛事的选择照样记着，切过去就是上次选的赛事。
  const [mode, setMode] = useState<PageMode>('all');
  const [allQuery, setAllQuery] = useState<AllMatchesQuery>(DEFAULT_ALL_QUERY);
  const [allReload, setAllReload] = useState(0);
  // 全部场次里点了「管理」：按需加载那一场所在赛事的数据，用同一个处理面板。
  const [allOverview, setAllOverview] = useState<Overview | null>(null);
  const [allEditingId, setAllEditingId] = useState<string | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState<MatchFilters>(EMPTY_FILTERS);
  // 视图只在拿到对局数据后才渲染，直接从本地存储取不会造成 SSR 不一致。
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const saved = readStorage(STORAGE_VIEW);
    return saved === 'court' || saved === 'bracket' || saved === 'list' ? saved : 'list';
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [releasingId, setReleasingId] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const reloadTimer = useRef<number | null>(null);
  const requestIdRef = useRef(0);

  // 「超时未开始」要跟着时间走：每 30 秒刷新一次当前时间。
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

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
      setNow(Date.now());
    } catch (error) {
      if (requestId === requestIdRef.current) {
        message.error(errorText(error, '加载对局数据失败'));
      }
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [token, selectedTournamentId]);

  // 赛事列表：管理员只有自己的赛事，超级管理员全部。进来时自动选上次选的，或唯一一个进行中的。
  useEffect(() => {
    if (!token || !canUse) return;
    let cancelled = false;
    apiFetch<MMTournament[]>('/match-management/tournaments', { token, cache: 'no-store' })
      .then((data) => {
        if (cancelled) return;
        setTournaments(data);
        setSelectedTournamentId((current) => current ?? pickInitialTournament(data, readStorage(STORAGE_TOURNAMENT), Date.now()));
      })
      .catch((error) => message.error(errorText(error, '加载赛事失败')))
      .finally(() => {
        if (!cancelled) setTournamentsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, canUse]);

  useEffect(() => {
    if (!token || !selectedTournamentId || mode !== 'tournament') return;
    const timer = window.setTimeout(() => {
      void loadOverview(selectedTournamentId);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [token, selectedTournamentId, loadOverview, mode]);

  useEffect(() => {
    if (!selectedTournamentId || mode !== 'tournament') return;
    const onFocus = () => void loadOverview();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [loadOverview, selectedTournamentId, mode]);

  // 实时联动：裁判端记分、其他后台改分或晋级后，自动刷新当前赛事的对局状态。
  useEffect(() => {
    if (!token || !selectedTournamentId || mode !== 'tournament') return;
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
  }, [token, selectedTournamentId, loadOverview, mode]);

  const selectedTournament = useMemo(
    () => tournaments.find((item) => item.id === selectedTournamentId) ?? null,
    [selectedTournamentId, tournaments],
  );

  const selectTournament = useCallback((value: string | null) => {
    requestIdRef.current += 1;
    setSelectedTournamentId(value);
    writeStorage(STORAGE_TOURNAMENT, value);
    setOverview(null);
    setEditingId(null);
    setFilters(EMPTY_FILTERS);
  }, []);

  const changeViewMode = useCallback((mode: ViewMode) => {
    setViewMode(mode);
    writeStorage(STORAGE_VIEW, mode);
  }, []);

  const matches = useMemo(() => overview?.matches ?? [], [overview]);
  const counts = useMemo(() => statusTabCounts(matches, now), [matches, now]);
  const visibleMatches = useMemo(
    () => filterMatches(matches, filters, now).sort(compareMatches) as MatchView[],
    [matches, filters, now],
  );
  const board = useMemo(() => buildCourtBoard(visibleMatches, overview?.venues ?? []), [visibleMatches, overview]);
  const editing = useMemo(() => matches.find((match) => match.id === editingId) ?? null, [matches, editingId]);
  const projectOf = useCallback((match: { id: string }) => {
    const full = matches.find((item) => item.id === match.id);
    return full ? projectLabel(full, overview) : '';
  }, [matches, overview]);

  const projectOptions = useMemo(() => [
    ...(overview?.events ?? []).map((event) => ({ value: `E:${event.id}`, label: event.typeLabel })),
    ...(overview?.teamCompetitions ?? []).map((competition) => ({ value: `T:${competition.id}`, label: `团体 · ${competition.name}` })),
  ], [overview]);
  const venueOptions = useMemo(() => [
    ...(overview?.venues ?? []).map((venue) => ({ value: venue.id, label: `${venue.name}${venue.isActive ? '' : '（停用）'}` })),
    { value: NONE, label: '待排场地' },
  ], [overview]);
  const refereeOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const referee of overview?.referees ?? []) byId.set(referee.id, referee.username);
    for (const match of matches) if (match.referee) byId.set(match.referee.id, match.referee.username);
    return [
      ...[...byId.entries()].sort((a, b) => a[1].localeCompare(b[1], 'zh-CN')).map(([value, label]) => ({ value, label })),
      { value: NONE, label: '未分配' },
    ];
  }, [overview, matches]);
  const dateOptions = useMemo(() => {
    const days = [...new Set(matches.map((match) => matchDateKey(match)).filter((day): day is string => Boolean(day)))].sort();
    return [
      ...days.map((day) => ({ value: day, label: dayjs(day).format('MM-DD ddd') })),
      { value: NONE, label: '待排时间' },
    ];
  }, [matches]);

  const handleSaved = useCallback(async () => {
    setEditingId(null);
    await loadOverview();
  }, [loadOverview]);

  /**
   * 解除单场比赛的裁判接手：只把这一场改回「未分配」，裁判端立刻失去记分权限。
   * 进行中的比赛先过一道红色二次确认，后端也要求 force 才放行。
   */
  const releaseReferee = useCallback(async (matchId: string, known?: ReleaseTarget) => {
    const match: ReleaseTarget | undefined = known
      ?? (mode === 'all' ? allOverview?.matches : matches)?.find((item) => item.id === matchId);
    if (!token || !match) return false;
    const live = match.status === 'LIVE';
    const refereeName = match.referee?.username ?? '该裁判';
    const confirmed = await new Promise<boolean>((resolve) => {
      Modal.confirm({
        title: live ? '比赛正在进行，确认解除裁判？' : '解除裁判接手？',
        content: live
          ? `${refereeName} 正在记分（${scoreText(match)}）。解除后该裁判会立即失去本场记分权限并被移出记分页，已录入的比分保留，本场回到「未分配」。`
          : `解除后 ${refereeName} 不再执裁本场，比赛回到「未分配」，其他裁判可以重新接手。`,
        okText: live ? '确认解除' : '解除',
        okButtonProps: live ? { danger: true } : undefined,
        cancelText: '取消',
        onOk: () => resolve(true),
        onCancel: () => resolve(false),
      });
    });
    if (!confirmed) return false;
    setReleasingId(match.id);
    try {
      await apiFetch(`/match-management/matches/${match.id}/release-referee`, {
        method: 'POST',
        token,
        body: JSON.stringify({ force: live }),
      });
      message.success('已解除裁判接手，本场回到未分配');
      if (mode === 'all') setAllReload((value) => value + 1);
      else await loadOverview();
      return true;
    } catch (error) {
      message.error(errorText(error, '解除裁判失败'));
      return false;
    } finally {
      setReleasingId(null);
    }
  }, [token, matches, allOverview, mode, loadOverview]);

  const changeMode = useCallback((next: PageMode) => {
    setMode(next);
    setEditingId(null);
    setAllEditingId(null);
  }, []);

  /** 进入某个赛事（按赛事）；带 matchId 时数据加载完自动打开这一场。 */
  const enterTournament = useCallback((tournamentId: string, matchId?: string | null) => {
    setMode('tournament');
    setAllEditingId(null);
    if (tournamentId !== selectedTournamentId) selectTournament(tournamentId);
    setFilters(EMPTY_FILTERS);
    setEditingId(matchId ?? null);
  }, [selectedTournamentId, selectTournament]);

  /** 全部场次里打开一场：取那个赛事的数据（场地、裁判、计分规则），在当前页打开处理面板。 */
  const openAllMatch = useCallback(async (tournamentId: string | null, matchId: string) => {
    if (!token || !tournamentId) return;
    const hide = message.loading('正在打开…', 0);
    try {
      const data = await apiFetch<Overview>(`/match-management/tournaments/${tournamentId}/overview`, { token, cache: 'no-store' });
      if (!data.matches.some((match) => match.id === matchId)) {
        message.warning('这一场已经不在了，列表已刷新');
        setAllReload((value) => value + 1);
        return;
      }
      setAllOverview(data);
      setAllEditingId(matchId);
      setNow(Date.now());
    } catch (error) {
      message.error(errorText(error, '加载对局数据失败'));
    } finally {
      hide();
    }
  }, [token]);

  const allEditing = useMemo(
    () => (allEditingId ? allOverview?.matches.find((match) => match.id === allEditingId) ?? null : null),
    [allOverview, allEditingId],
  );

  // 处理面板开着时那个赛事有比分变化：把面板里的数据也刷新（和「按赛事」一样实时）。
  const refreshAllDrawer = useCallback(async (tournamentId: string) => {
    if (!token || !allEditingId || allOverview?.tournament.id !== tournamentId) return;
    try {
      const data = await apiFetch<Overview>(`/match-management/tournaments/${tournamentId}/overview`, { token, cache: 'no-store' });
      setAllOverview((current) => (current?.tournament.id === tournamentId ? data : current));
    } catch {
      // 刷新失败就保留旧数据，保存时后端会再校验
    }
  }, [token, allEditingId, allOverview]);

  const handleAllSaved = useCallback(async () => {
    setAllEditingId(null);
    setAllReload((value) => value + 1);
  }, []);

  /** 跨赛事搜索点了一场：全部场次里直接打开；按赛事时切到那个赛事（数据加载完抽屉自动打开这一场）。 */
  const openFromSearch = useCallback(({ tournamentId, matchId }: { tournamentId: string; matchId: string }) => {
    setSearchOpen(false);
    if (mode === 'all') {
      void openAllMatch(tournamentId, matchId);
      return;
    }
    if (tournamentId !== selectedTournamentId) selectTournament(tournamentId);
    setFilters(EMPTY_FILTERS);
    setEditingId(matchId);
  }, [mode, openAllMatch, selectedTournamentId, selectTournament]);

  if (!access.ready) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', minHeight: 320 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!canUse) {
    return (
      <Result
        status="403"
        title="无权访问"
        subTitle="你的账号没有「裁判员对局管理」权限，请联系超级管理员在用户管理里开通。"
      />
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <Title level={3} style={{ margin: 0 }}>裁判员对局管理</Title>
          <Text type="secondary">
            {isRoot ? '查看和处理所有赛事的对局' : '查看和处理你创建的赛事的对局'}：时间、场地、裁判、比分、结束与重开，改动实时同步到公开赛程、现场大屏和裁判端。
          </Text>
        </div>
        <Space wrap>
          <Button icon={<SearchOutlined />} onClick={() => setSearchOpen(true)}>跨赛事搜选手</Button>
          {mode === 'tournament' ? (
            <>
              <Button href={selectedTournamentId ? `/competitions/${selectedTournamentId}/brackets` : undefined} target="_blank" disabled={!selectedTournamentId}>
                公开签表
              </Button>
              <Button href={selectedTournamentId ? `/live-screen/${selectedTournamentId}` : undefined} target="_blank" disabled={!selectedTournamentId}>
                现场大屏
              </Button>
              <Button icon={<ReloadOutlined />} onClick={() => void loadOverview()} loading={loading} disabled={!selectedTournamentId}>
                刷新
              </Button>
            </>
          ) : (
            <Button icon={<ReloadOutlined />} onClick={() => setAllReload((value) => value + 1)}>刷新</Button>
          )}
        </Space>
      </div>

      <Card style={{ marginTop: 16 }} styles={{ body: { padding: '12px 16px' } }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
          <Segmented
            value={mode}
            onChange={(value) => changeMode(value as PageMode)}
            options={[
              { value: 'all', label: '全部场次', icon: <UnorderedListOutlined /> },
              { value: 'tournament', label: '按赛事', icon: <TrophyOutlined /> },
            ]}
          />
          {mode === 'all' ? (
            <Text type="secondary">
              {isRoot ? '所有赛事' : '你创建的赛事'}的场次放在一起看；点「管理」直接处理，点赛事名进入该赛事。
            </Text>
          ) : (
            <>
              <Text strong>赛事</Text>
              <TournamentPicker
                tournaments={tournaments}
                value={selectedTournamentId}
                loading={tournamentsLoading}
                showOwner={isRoot}
                now={now}
                onChange={selectTournament}
              />
              {selectedTournament ? <TournamentStatusTag tournament={selectedTournament} /> : null}
              {selectedTournamentId ? (
                <Button type="link" icon={<UnorderedListOutlined />} onClick={() => selectTournament(null)} style={{ paddingInline: 0 }}>
                  赛事列表
                </Button>
              ) : null}
              {overview ? (
                <Space wrap size={14} style={{ marginLeft: 'auto' }}>
                  <Text type="secondary"><TrophyOutlined /> 单项 {overview.events.length}</Text>
                  <Text type="secondary"><TeamOutlined /> 团体 {overview.teamCompetitions.length}</Text>
                  <Text type="secondary">
                    {dayjs(overview.tournament.startDate).format('YYYY-MM-DD')} ~ {dayjs(overview.tournament.endDate).format('MM-DD')}
                  </Text>
                  {overview.tournament.location ? <Text type="secondary">{overview.tournament.location}</Text> : null}
                  {isRoot && selectedTournament?.owner ? <Text type="secondary">创建账号 {selectedTournament.owner}</Text> : null}
                </Space>
              ) : null}
            </>
          )}
        </div>
      </Card>

      {mode === 'all' ? (
        <AllMatchesView
          token={token}
          query={allQuery}
          onQueryChange={setAllQuery}
          tournaments={tournaments}
          showOwner={isRoot}
          now={now}
          reloadSignal={allReload}
          onOpen={(match: MMAllMatch) => void openAllMatch(match.tournamentId, match.id)}
          onRelease={(match: MMAllMatch) => void releaseReferee(match.id, match)}
          releasingId={releasingId}
          onEnterTournament={(tournamentId) => enterTournament(tournamentId)}
          onRemoteChange={(tournamentId) => void refreshAllDrawer(tournamentId)}
        />
      ) : !selectedTournamentId ? (
        <TournamentDirectory
          tournaments={tournaments}
          loading={tournamentsLoading}
          showOwner={isRoot}
          now={now}
          onPick={selectTournament}
        />
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
          <MatchToolbar
            counts={counts}
            filters={filters}
            onChange={setFilters}
            projectOptions={projectOptions}
            venueOptions={venueOptions}
            refereeOptions={refereeOptions}
            dateOptions={dateOptions}
            viewMode={viewMode}
            onViewModeChange={changeViewMode}
            shown={visibleMatches.length}
          />

          {!matches.length ? (
            <Card style={{ marginTop: 16 }}>
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="该赛事暂无对局，请先完成抽签编排或团体对阵生成" />
            </Card>
          ) : !visibleMatches.length ? (
            <Card style={{ marginTop: 16 }}>
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有符合筛选条件的场次">
                <Button onClick={() => setFilters(EMPTY_FILTERS)}>清空筛选</Button>
              </Empty>
            </Card>
          ) : viewMode === 'court' ? (
            <CourtBoard board={board} now={now} projectOf={projectOf} onOpen={setEditingId} />
          ) : viewMode === 'list' ? (
            <MatchList
              matches={visibleMatches}
              now={now}
              projectOf={projectOf}
              onOpen={setEditingId}
              onRelease={(id) => void releaseReferee(id)}
              releasingId={releasingId}
            />
          ) : (
            <BracketSections overview={overview} matches={visibleMatches} now={now} onEdit={setEditingId} />
          )}
        </>
      )}

      <MatchManageDrawer
        key={editing?.id ?? 'closed'}
        match={editing}
        overview={overview}
        token={token}
        now={now}
        onClose={() => setEditingId(null)}
        onSaved={handleSaved}
        onRelease={releaseReferee}
        releasingId={releasingId}
      />

      <MatchManageDrawer
        key={`all:${allEditing?.id ?? 'closed'}`}
        match={allEditing}
        overview={allOverview}
        token={token}
        now={now}
        onClose={() => setAllEditingId(null)}
        onSaved={handleAllSaved}
        onRelease={releaseReferee}
        releasingId={releasingId}
        onEnterTournament={allOverview && allEditing ? () => enterTournament(allOverview.tournament.id, allEditing.id) : undefined}
      />

      <GlobalMatchSearch open={searchOpen} token={token} onClose={() => setSearchOpen(false)} onPick={openFromSearch} />
    </div>
  );
}

/**
 * 对阵表视图：每个单项 / 团体赛一个可折叠面板；面板里每个阶段（小组、轮次）一张卡，自动换行排，不再横向拖。
 * 默认展开前两个。
 */
function BracketSections({
  overview,
  matches,
  now,
  onEdit,
}: {
  overview: Overview;
  matches: MatchView[];
  now: number;
  onEdit: (matchId: string) => void;
}) {
  const items: Array<{ key: string; label: ReactNode; children: ReactNode }> = [];
  for (const event of overview.events) {
    const eventMatches = matches.filter((match) => match.eventId === event.id);
    if (!eventMatches.length) continue;
    items.push({
      key: `event-${event.id}`,
      label: (
        <Space wrap size={8}>
          <Tag color="blue" style={{ marginInlineEnd: 0 }}>{event.typeLabel}</Tag>
          <Text>{event.formatLabel}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            显示 {eventMatches.length} 场 · 全部 {event.matchCount} 场 · 已结束 {event.completedCount}
          </Text>
        </Space>
      ),
      children: <StageBoard matches={eventMatches} now={now} onEdit={onEdit} />,
    });
  }
  for (const competition of overview.teamCompetitions) {
    const competitionMatches = matches.filter((match) => match.teamCompetitionId === competition.id);
    if (!competitionMatches.length) continue;
    items.push({
      key: `team-${competition.id}`,
      label: (
        <Space wrap size={8}>
          <Tag color="purple" style={{ marginInlineEnd: 0 }}>团体赛</Tag>
          <Text>{competition.name}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {competition.formatLabel} · {competition.matchCount} 个子项 · 已结束 {competition.completedCount}
          </Text>
        </Space>
      ),
      children: <TeamBoard competition={competition} matches={competitionMatches} now={now} onEdit={onEdit} />,
    });
  }
  return (
    <Collapse
      style={{ marginTop: 16, background: '#fff' }}
      defaultActiveKey={items.slice(0, 2).map((item) => item.key)}
      items={items}
    />
  );
}

function StageBoard({ matches, now, onEdit }: { matches: MatchView[]; now: number; onEdit: (matchId: string) => void }) {
  const stages = useMemo(() => groupByStage(matches), [matches]);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
      {stages.map((stage) => {
        const completed = stage.matches.filter((match) => match.status === 'COMPLETED').length;
        return (
          <div key={stage.key} style={{ border: '1px solid #dbe7fb', borderRadius: 10, overflow: 'hidden', background: '#fff' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '6px 10px', background: '#f1f5fd' }}>
              <Text strong style={{ color: '#03205c' }}>{stage.label}</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>{completed}/{stage.matches.length}</Text>
            </div>
            <div>
              {stage.matches.map((match, index) => (
                <MatchRow key={match.id} match={match} now={now} first={index === 0} onEdit={onEdit} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** 对阵表里的一场：一行时间场地状态，两行双方和每局比分。点了打开管理。 */
function MatchRow({ match, now, first, onEdit }: { match: MatchView; now: number; first: boolean; onEdit: (matchId: string) => void }) {
  const live = match.status === 'LIVE';
  const games = match.games.length ? match.games : null;
  return (
    <button
      type="button"
      onClick={() => onEdit(match.id)}
      title="点击管理本场"
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        border: 'none',
        borderTop: first ? 'none' : '1px solid #f1f5f9',
        background: live ? '#fff7f6' : '#fff',
        padding: '7px 10px',
        cursor: 'pointer',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: 11, color: '#64748b' }}>
        <span style={{ fontWeight: 700, color: '#475569' }}>第 {match.matchNo} 场</span>
        {match.code ? <span style={{ color: '#0f4c9c', fontWeight: 700 }}>{match.code}</span> : null}
        <span>{match.scheduledAt ? dayjs(match.scheduledAt).format('MM-DD HH:mm') : '待排时间'}</span>
        <span>{match.venue?.name ?? '待排场地'}</span>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 4 }}>
          <AttentionTags match={match} now={now} />
          <StatusTag status={match.status} />
        </span>
      </div>
      {([1, 2] as const).map((side) => (
        <div key={side} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'center', fontSize: 13 }}>
          <SideName match={match} side={side} />
          <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 700, color: '#334155' }}>
            {games ? games.map((game) => (side === 1 ? game.side1Score : game.side2Score)).join(' ') : ''}
          </span>
        </div>
      ))}
    </button>
  );
}

function TeamBoard({
  competition,
  matches,
  now,
  onEdit,
}: {
  competition: TeamCompetitionSummary;
  matches: MatchView[];
  now: number;
  onEdit: (matchId: string) => void;
}) {
  const encounters = competition.teamMatches
    .map((encounter) => ({
      ...encounter,
      children: matches.filter((match) => match.teamMatchId === encounter.id),
    }))
    .filter((encounter) => encounter.children.length > 0);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
      {encounters.map((encounter) => (
        <div key={encounter.id} style={{ border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden', background: '#fff' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '8px 10px', background: '#f8fafc', borderBottom: '1px solid #eef2f7', flexWrap: 'wrap' }}>
            <Space wrap size={6}>
              <Text strong>{encounter.team1?.name ?? '待定'}</Text>
              <Text strong style={{ color: '#0f4c9c' }}>{encounter.team1Wins} : {encounter.team2Wins}</Text>
              <Text strong>{encounter.team2?.name ?? '待定'}</Text>
            </Space>
            <Space wrap size={6}>
              <StatusTag status={encounter.status} />
              <Text type="secondary" style={{ fontSize: 12 }}>
                {encounter.groupName ? `${encounter.groupName} · ` : ''}
                {encounter.round || `第 ${encounter.roundNo} 轮`} 第 {encounter.matchNo} 场
              </Text>
            </Space>
          </div>
          {encounter.children.map((match, index) => (
            <MatchRow key={match.id} match={match} now={now} first={index === 0} onEdit={onEdit} />
          ))}
        </div>
      ))}
    </div>
  );
}

type DrawerTab = 'info' | 'score' | 'status' | 'logs';

function MatchManageDrawer({
  match,
  overview,
  token,
  now,
  onClose,
  onSaved,
  onRelease,
  releasingId,
  onEnterTournament,
}: {
  match: MatchView | null;
  overview: Overview | null;
  token?: string;
  now: number;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
  onRelease: (matchId: string) => Promise<boolean>;
  releasingId: string | null;
  /** 从「全部场次」打开时：标题区显示赛事名，并可以进入该赛事。 */
  onEnterTournament?: () => void;
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
  const [tab, setTab] = useState<DrawerTab>(() => {
    if (match && matchAttention(match, Date.now()).includes('UNFINISHED')) return 'status';
    return match && match.status !== 'PENDING' ? 'score' : 'info';
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
    scheduleLocked: true,
    allowOutsideGroup: false,
  };

  async function saveBasic() {
    if (!token || !match) return;
    let values: {
      scheduledAt?: Dayjs | null;
      venueId?: string | null;
      durationMinutes?: number;
      refereeId?: string | null;
      scheduleLocked?: boolean;
      allowOutsideGroup?: boolean;
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

    if (payload.venueId !== undefined || payload.scheduledAt !== undefined || payload.durationMinutes !== undefined) {
      payload.scheduleLocked = values.scheduleLocked; payload.allowOutsideGroup = values.allowOutsideGroup;
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

  /** 解除本场裁判接手，成功后关闭抽屉（列表会随 overview 刷新回到「未分配」）。 */
  async function handleRelease() {
    if (!match) return;
    const done = await onRelease(match.id);
    if (done) onClose();
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

  const statusLabel = match ? STATUS_LABELS[match.status] ?? match.status : '';
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
  // 管理员只能指派自己名下的裁判；当前裁判不在列表里（比如超级管理员指派的）时也要能显示名字。
  const refereeOptions = useMemo(() => {
    const options = (overview?.referees ?? []).map((referee) => ({
      value: referee.id,
      label: `${referee.username}（已裁 ${referee.refereedMatchesCount} 场）`,
    }));
    if (match?.referee && !options.some((option) => option.value === match.referee?.id)) {
      options.push({ value: match.referee.id, label: `${match.referee.username}（当前）` });
    }
    return options;
  }, [overview, match]);

  const infoTab = match && overview ? (
    <Form form={form} layout="vertical" requiredMark={false} initialValues={initialValues}>
      <Form.Item name="scheduledAt" label="比赛时间">
        <DatePicker showTime={{ format: 'HH:mm' }} format="YYYY-MM-DD HH:mm" style={{ width: '100%' }} allowClear placeholder="待排时间" />
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
        <Form.Item name="durationMinutes" label="预估时长（分钟）" rules={[{ required: true, message: '请输入预估时长' }]}>
          <InputNumber min={1} max={600} precision={0} style={{ width: '100%' }} />
        </Form.Item>
      </div>
      <Form.Item name="refereeId" label="执裁裁判" extra={refereeOptions.length ? undefined : '你名下还没有裁判账号，可以在「用户管理」里添加。'}>
        <Select allowClear showSearch optionFilterProp="label" placeholder="未分配" options={refereeOptions} />
      </Form.Item>
      {match.referee ? (
        <div style={{ marginTop: -10, marginBottom: 12 }}>
          {match.status === 'COMPLETED' ? (
            <Text type="secondary" style={{ fontSize: 12 }}>已结束的比赛如需解除执裁，请先在「结束 · 重开」里重开本场。</Text>
          ) : match.status === 'CANCELLED' ? (
            <Text type="secondary" style={{ fontSize: 12 }}>已取消的比赛无需解除执裁。</Text>
          ) : (
            <Space size={8} wrap>
              <Button size="small" danger loading={releasingId === match.id} onClick={() => void handleRelease()}>
                解除裁判接手
              </Button>
              <Text type="secondary" style={{ fontSize: 12 }}>解除后本场回到「未分配」，该裁判立即失去记分权限。</Text>
            </Space>
          )}
        </div>
      ) : null}
      <Form.Item name="scheduleLocked" valuePropName="checked" style={{ marginBottom: 4 }}>
        <Checkbox>保留本次人工排程（自动排程时不挪动这一场）</Checkbox>
      </Form.Item>
      <Form.Item name="allowOutsideGroup" valuePropName="checked">
        <Checkbox>允许本场临时超出组别规则（范围外场地或日期）</Checkbox>
      </Form.Item>
      {match.teamMatchId ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          title="团体赛子项联动"
          description="修改时间或场地后，本场团体对阵的未开始子项会按顺序整场顺延，并同步到裁判端。"
        />
      ) : null}
      <Text type="secondary" style={{ display: 'block', marginBottom: 12, fontSize: 12 }}>
        时间与场地修改会立即生效，系统不会自动重排其他场次；如需整体冲突检测，请到「场地排程」处理。
      </Text>
      <Button type="primary" onClick={() => void saveBasic()} loading={savingBasic}>
        保存时间 / 场地 / 裁判
      </Button>
    </Form>
  ) : null;

  const scoreTab = match ? (
    <div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '64px 1fr 18px 1fr', gap: 8, fontSize: 12, color: '#64748b' }}>
          <span />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sideName(match.side1)}</span>
          <span />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sideName(match.side2)}</span>
        </div>
        {games.map((game) => (
          <div key={game.gameNo} style={{ display: 'grid', gridTemplateColumns: '64px 1fr 18px 1fr', alignItems: 'center', gap: 8 }}>
            <Text>第 {game.gameNo} 局</Text>
            <InputNumber
              min={0}
              max={999}
              precision={0}
              value={game.side1Score}
              onChange={(value) => setGames((current) => current.map((item) => (
                item.gameNo === game.gameNo ? { ...item, side1Score: Math.max(0, Math.trunc(value ?? 0)) } : item
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
                item.gameNo === game.gameNo ? { ...item, side2Score: Math.max(0, Math.trunc(value ?? 0)) } : item
              )))}
              style={{ width: '100%' }}
            />
          </div>
        ))}
      </div>
      <Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
        保存后会按本场计分规则重新判定每局与整场胜负；未进行的后续局请保持 0:0。
        {match.status === 'COMPLETED' ? ' 已结束场次可直接改分改判，胜方变化时下一轮签位会自动换成新胜方（保留原定时间场地）；下一轮已产生比分时不能改判。本场如有签字的电子比分单，改分后会标为作废（记录保留）。' : ''}
      </Text>
      <Button
        style={{ marginTop: 12 }}
        type="primary"
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
    </div>
  ) : null;

  const statusTab = match ? (
    <Space orientation="vertical" size={10} style={{ width: '100%' }}>
      <Alert
        type={match.forfeitedSide !== null ? 'warning' : 'info'}
        showIcon
        title={`当前状态：${statusLabel}`}
        description={
          match.forfeitedSide !== null
            ? `本场由弃权/退赛判定：${match.forfeitReason ?? '未填写原因'}。此类赛果不能在此重开。`
            : match.status === 'COMPLETED'
              ? '本场已结束。可直接在「比分」里修改比分（胜方随比分改判），无需重开。'
              : match.status === 'CANCELLED'
                ? '本场已取消，不能在此修改赛果。'
                : match.status === 'LIVE'
                  ? '比赛进行中。已决出胜方时可直接结束；否则请先在「比分」里补录比分。'
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
          <Button type="primary" icon={<CheckCircleOutlined />} loading={statusBusy}>结束本场并推进晋级</Button>
        </Popconfirm>
      ) : null}
      {canReopen ? (
        <Popconfirm
          title="重开本场？"
          description="会清除本场胜方并撤销已推进到下一轮的签位；若后续轮次或团体后续子项已开赛，将被拒绝。本场如有胜方和裁判签字的电子比分单，会标为作废（记录保留）。"
          okText="确认重开"
          okButtonProps={{ danger: true }}
          cancelText="取消"
          onConfirm={() => void reopenMatch()}
        >
          <Button danger icon={<StopOutlined />} loading={statusBusy}>重开本场（改分后重新结束）</Button>
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
  ) : null;

  return (
    <Drawer
      title={match ? (match.teamMatchId ? `管理对局 · ${match.itemTypeLabel ?? '团体子项'}` : `管理对局 · 第 ${match.matchNo} 场`) : '管理对局'}
      open={Boolean(match)}
      onClose={onClose}
      size="min(640px, 100vw)"
      destroyOnHidden
      extra={match?.code ? <Tag color="blue">{match.code}</Tag> : null}
    >
      {match && overview ? (
        <div>
          <div style={{ borderRadius: 10, border: '1px solid #e2e8f0', background: '#f8fafc', padding: '12px 14px' }}>
            {onEnterTournament ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <Text strong style={{ fontSize: 13, minWidth: 0 }}>{overview.tournament.name}</Text>
                <Button type="link" size="small" onClick={onEnterTournament} style={{ paddingInline: 0, marginLeft: 'auto' }}>
                  进入该赛事
                </Button>
              </div>
            ) : null}
            <Text type="secondary" style={{ fontSize: 12 }}>
              {projectLabel(match, overview)} · {match.stageLabel} · {match.scheduledAt ? dayjs(match.scheduledAt).format('MM-DD HH:mm') : '待排时间'} · {match.venue?.name ?? '待排场地'}
            </Text>
            <div style={{ marginTop: 6, fontSize: 18, fontWeight: 800, color: '#03205c' }}>{matchVersus(match)}</div>
            {match.teamMatchId ? (
              <Text type="secondary" style={{ display: 'block', marginTop: 2, fontSize: 12 }}>
                {sideName(match.side1)} vs {sideName(match.side2)}
              </Text>
            ) : null}
            <Space wrap size={8} style={{ marginTop: 8 }}>
              <StatusTag status={match.status} />
              <AttentionTags match={match} now={now} />
              <Text strong style={{ fontFamily: 'ui-monospace, monospace' }}>{scoreText(match)}</Text>
              {match.winnerSide ? <Text type="secondary">胜方：{sideName(match.winnerSide === 1 ? match.side1 : match.side2)}</Text> : null}
              <Text type="secondary">裁判：{match.referee?.username ?? '未分配'}</Text>
            </Space>
          </div>
          <Tabs
            style={{ marginTop: 8 }}
            activeKey={tab}
            onChange={(key) => setTab(key as DrawerTab)}
            items={[
              { key: 'info', label: '时间 · 场地 · 裁判', children: infoTab },
              { key: 'score', label: '比分', children: scoreTab },
              { key: 'status', label: '结束 · 重开', children: statusTab },
              { key: 'logs', label: '操作记录', children: <MatchLogs matchId={match.id} token={token} refreshKey={0} /> },
            ]}
          />
        </div>
      ) : null}
    </Drawer>
  );
}
