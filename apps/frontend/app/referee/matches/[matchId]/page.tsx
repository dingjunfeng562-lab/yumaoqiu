'use client';
import { useCurrentAccess } from '@/lib/use-current-role';

import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Alert, Button, Drawer, Input, Modal, Spin, message } from 'antd';
import {
  ArrowLeftOutlined,
  CloseCircleOutlined,
  ExclamationCircleOutlined,
  FieldTimeOutlined,
  FlagOutlined,
  LoadingOutlined,
  MedicineBoxOutlined,
  MenuOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  SwapOutlined,
  SyncOutlined,
  UndoOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { io, type Socket } from 'socket.io-client';
import { apiFetch } from '@/lib/api';

const API_BASE = process.env.NEXT_PUBLIC_API_URL!;
const SOCKET_BASE = API_BASE.replace(/\/api$/, '');

type GameScore = {
  id: string;
  gameNo: number;
  side1Score: number;
  side2Score: number;
  server?: number | null;
  winnerSide?: number | null;
};

type PlayerIndex = 1 | 2;
type CourtSide = 'left' | 'right';

type SidePlayer = {
  id: string;
  index: number;
  name: string;
  affiliation?: string | null;
  gender?: 'MALE' | 'FEMALE' | null;
};

type MatchSide = {
  name: string;
  affiliation: string;
  teamName?: string | null;
  players?: SidePlayer[];
};

type ServingState = {
  gameNo: number;
  servingSide?: 1 | 2 | null;
  serverPlayerIndex?: PlayerIndex | null;
  serverCourtSide?: CourtSide | null;
  receivingSide?: 1 | 2 | null;
  receiverPlayerIndex?: PlayerIndex | null;
  receiverCourtSide?: CourtSide | null;
  side1Positions?: Record<CourtSide, PlayerIndex | null>;
  side2Positions?: Record<CourtSide, PlayerIndex | null>;
  /** system = 新一局系统自动带出的默认值，还没被裁判核对；referee = 裁判已确认。 */
  source?: 'system' | 'referee' | null;
};

type CourtDisplayState = {
  side1CourtSide: CourtSide;
  side2CourtSide: CourtSide;
  swapCount: number;
};

type CourtSwapRequired = {
  required: boolean;
  gameNo: number | null;
};

type MatchEventLog = {
  id: string;
  type: string;
  side?: number | null;
  gameNo?: number | null;
  side1Score?: number | null;
  side2Score?: number | null;
  note?: string | null;
  undoneAt?: string | null;
  createdAt: string;
};

type RefereeEventType = 'TIMEOUT' | 'MEDICAL_TIMEOUT' | 'WARNING' | 'YELLOW_CARD';

type PendingRefereeAction =
  | {
      action?: 'event';
      type: RefereeEventType;
      label: string;
    }
  | {
      action: 'fault';
      faultType: string;
      label: string;
    }
  | {
      action: 'card';
      cardType: 'yellow' | 'red' | 'black';
      label: string;
    }
  | null;

type ScoreState = {
  id: string;
  referee?: { id: string } | null;
  status: 'PENDING' | 'LIVE' | 'COMPLETED' | 'CANCELLED';
  winnerSide?: number | null;
  pendingFinish?: boolean;
  forfeitedSide?: number | null;
  forfeitReason?: string | null;
  round: string;
  matchNo: number;
  event: {
    typeLabel: string;
    scoringRule: string;
    scoringMode: string;
    customGamePoint?: number | null;
    customGameCap?: number | null;
    customGamesToWin?: number | null;
    tournament: { id: string; name: string; edition: number } | null;
  };
  venue?: { id: string; name: string } | null;
  scheduledAt?: string | null;
  durationMinutes: number;
  startedAt?: string | null;
  finishedAt?: string | null;
  matchPaused?: boolean;
  pausedAt?: string | null;
  pauseKind?: 'manual' | 'technical' | 'interval' | null;
  pauseReason?: string | null;
  actualDurationSeconds?: number | null;
  side1?: MatchSide | null;
  side2?: MatchSide | null;
  side1Games: number;
  side2Games: number;
  games: GameScore[];
  currentGame?: GameScore | null;
  servingState?: ServingState | null;
  /** 最近一笔有效得分是哪一方的，决定哪一方的「-1」可用。 */
  lastPointSide?: 1 | 2 | null;
  /** 未开始的场次正在赛前练球时有值。 */
  warmup?: { startedAt: string; seconds: number } | null;
  /** 服务器当前时间，用来校准手机时钟，倒计时按服务器时间算。 */
  serverNow?: string | null;
  courtDisplayState?: CourtDisplayState | null;
  courtSwapRequired?: CourtSwapRequired | null;
  events: MatchEventLog[];
  updatedAt?: string | null;
};

type SocketStatus = '连接中' | '已连接' | '已断开';

const statusLabels: Record<ScoreState['status'], string> = {
  PENDING: '未开始',
  LIVE: '进行中',
  COMPLETED: '已结束',
  CANCELLED: '已取消',
};

const eventLabels: Record<string, string> = {
  POINT: '得分',
  UNDO: '撤销',
  TIMEOUT: '普通暂停',
  MEDICAL_TIMEOUT: '医疗暂停',
  WARNING: '警告',
  YELLOW_CARD: '黄牌',
  SERVE_CHANGE: '发球切换',
  FORFEIT: '弃权',
};

const SCORING_RULE_BASE: Record<string, { label: string; target: number; cap: number; gamesToWin: number }> = {
  FIFTEEN_ONE: { label: '15分1局', target: 15, cap: 20, gamesToWin: 1 },
  FIFTEEN_BO3: { label: '15分3局2胜', target: 15, cap: 20, gamesToWin: 2 },
  TWENTYONE_BO3: { label: '21分3局2胜', target: 21, cap: 30, gamesToWin: 2 },
  THIRTYONE_BO3: { label: '31分3局2胜', target: 31, cap: 31, gamesToWin: 2 },
};

function formatScoringRule(event: ScoreState['event']) {
  const base = SCORING_RULE_BASE[event.scoringRule] ?? { label: event.scoringRule, target: 21, cap: 30, gamesToWin: 2 };
  const target = event.customGamePoint && event.customGamePoint > 0 ? event.customGamePoint : base.target;
  let cap = base.cap;
  if (event.customGamePoint && event.customGamePoint > 0) {
    cap = event.customGameCap && event.customGameCap >= event.customGamePoint ? event.customGameCap : event.customGamePoint;
  } else if (event.customGameCap && event.customGameCap > 0) {
    cap = event.customGameCap;
  }
  const gamesToWin = event.customGamesToWin && event.customGamesToWin > 0 ? event.customGamesToWin : base.gamesToWin;
  const isCustom = Boolean(event.customGamePoint || event.customGameCap || event.customGamesToWin);
  const capPart = cap > target ? `（封顶${cap}）` : '';
  const seriesPart = gamesToWin === 1 ? '单局制' : `${gamesToWin * 2 - 1}局${gamesToWin}胜`;
  return {
    label: isCustom ? `自定义：${target}分/局${capPart}，${seriesPart}` : base.label,
    target,
    cap,
    gamesToWin,
    isCustom,
  };
}

function sideName(side?: { name: string } | null) {
  return side?.name ?? '待定';
}

function sidePlayers(side?: MatchSide | null): SidePlayer[] {
  if (side?.players?.length) return side.players;
  return [{ id: side?.name ?? 'pending', index: 1, name: sideName(side), affiliation: side?.affiliation ?? null }];
}

function sideDisplayName(side?: MatchSide | null) {
  return side?.teamName || sideName(side);
}

function isDoublesSide(side?: MatchSide | null) {
  return sidePlayers(side).length > 1;
}

/** side1 固定叫 A 方、side2 叫 B 方，交换场地后跟着人走，不跟左右走。 */
function sideLetter(side: 1 | 2) {
  return side === 1 ? 'A' : 'B';
}

function genderLabel(gender?: SidePlayer['gender']) {
  return gender === 'MALE' ? '男' : gender === 'FEMALE' ? '女' : null;
}

function courtSideLabel(courtSide?: CourtSide | null) {
  return courtSide === 'left' ? '左发球区' : '右发球区';
}

function playerNameByIndex(
  side: MatchSide | null | undefined,
  playerIndex: PlayerIndex | null | undefined,
) {
  if (!playerIndex) return '';
  return sidePlayers(side).find((player) => player.index === playerIndex)?.name ?? `选手 ${playerIndex}`;
}

function courtListHref(score: ScoreState) {
  return score.venue && score.event.tournament
    ? `/referee/tournaments/${encodeURIComponent(score.event.tournament.id)}/courts/${encodeURIComponent(score.venue.id)}`
    : '/referee/my-matches';
}

/** 老版本后端没有 lastPointSide 时，从最近的事件里找最后一笔没被撤销的得分。 */
function lastPointSideOf(score: ScoreState): 1 | 2 | null {
  if (score.lastPointSide !== undefined) return score.lastPointSide;
  const side = score.events.find((event) => event.type === 'POINT' && !event.undoneAt)?.side;
  return side === 1 || side === 2 ? side : null;
}

function MatchClock({
  startedAt,
  finishedAt,
  status,
  matchPaused = false,
  actualDurationSeconds,
  className,
}: {
  startedAt?: string | null;
  finishedAt?: string | null;
  status: ScoreState['status'];
  matchPaused?: boolean;
  actualDurationSeconds?: number | null;
  className?: string;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [baseReceivedAt, setBaseReceivedAt] = useState(() => Date.now());

  useEffect(() => {
    setBaseReceivedAt(Date.now());
    setNow(Date.now());
  }, [actualDurationSeconds, finishedAt, matchPaused, startedAt, status]);

  useEffect(() => {
    if (status !== 'LIVE' || finishedAt || matchPaused) return;
    const handle = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(handle);
  }, [status, finishedAt, matchPaused]);

  if (!startedAt) return null;
  const startMs = new Date(startedAt).getTime();
  if (Number.isNaN(startMs)) return null;
  let seconds: number;
  if (typeof actualDurationSeconds === 'number') {
    seconds = Math.max(0, Math.floor(actualDurationSeconds));
    if (status === 'LIVE' && !finishedAt && !matchPaused) {
      seconds += Math.max(0, Math.floor((now - baseReceivedAt) / 1000));
    }
  } else {
    const endMs = finishedAt ? new Date(finishedAt).getTime() : now;
    seconds = Math.max(0, Math.floor((endMs - startMs) / 1000));
  }
  const mm = Math.floor(seconds / 60).toString().padStart(2, '0');
  const ss = (seconds % 60).toString().padStart(2, '0');
  const label = finishedAt ? '比赛用时' : matchPaused ? '比赛暂停，计时已停止' : '比赛计时';
  return (
    <span className={className} title={label}>
      <FieldTimeOutlined />
      <span className="tabular-nums">{mm}:{ss}</span>
    </span>
  );
}

function formatDateTime(value?: string | null) {
  if (!value) return '未排时间';
  return new Date(value).toLocaleString('zh-CN', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function currentGameOf(score: ScoreState) {
  return score.currentGame ?? score.games.at(-1) ?? null;
}

function currentGameNo(score: ScoreState) {
  return currentGameOf(score)?.gameNo ?? 1;
}

function currentSideScore(score: ScoreState, side: 1 | 2) {
  const game = currentGameOf(score);
  if (!game) return 0;
  return side === 1 ? game.side1Score : game.side2Score;
}

function recordItems(score: ScoreState) {
  const gameMap = new Map(score.games.map((game) => [game.gameNo, game]));
  return [1, 2, 3].map((gameNo) => {
    const game = gameMap.get(gameNo);
    return {
      gameNo,
      side1Score: game?.side1Score ?? 0,
      side2Score: game?.side2Score ?? 0,
      winnerSide: game?.winnerSide ?? null,
      active: currentGameNo(score) === gameNo && score.status !== 'COMPLETED' && score.status !== 'CANCELLED',
      exists: Boolean(game),
    };
  });
}

function eventDescription(event: MatchEventLog, side1Name?: string, side2Name?: string) {
  if (event.note?.startsWith('WARMUP:')) {
    const [, action, secondsText] = event.note.split(':');
    return action === 'START' ? `开始赛前练球 · ${Number(secondsText) / 60} 分钟` : '结束赛前练球';
  }
  const pauseAction = event.note?.startsWith('MATCH_PAUSE:START') || event.note?.startsWith('TECHNICAL_PAUSE:START')
    || event.note?.startsWith('INTERVAL_REST:START')
    ? 'START'
    : event.note?.startsWith('MATCH_PAUSE:END') || event.note?.startsWith('TECHNICAL_PAUSE:END')
      || event.note?.startsWith('INTERVAL_REST:END')
      ? 'END'
      : null;
  const structuredNote = parseRefereeStructuredNote(event.note);
  const label = pauseAction === 'START'
    ? '比赛暂停'
    : pauseAction === 'END'
      ? '比赛恢复'
      : structuredNote?.label
        ? structuredNote.label
        : eventLabels[event.type] ?? event.type;
  const sideText =
    event.side === 1
      ? ` · ${side1Name ?? '选手 1'}`
      : event.side === 2
        ? ` · ${side2Name ?? '选手 2'}`
        : '';
  const scoreText =
    typeof event.side1Score === 'number' && typeof event.side2Score === 'number'
      ? ` · ${event.side1Score}:${event.side2Score}`
      : '';
  const gameText = event.gameNo ? ` · 第 ${event.gameNo} 局` : '';
  const noteText = event.note && !pauseAction ? ` · ${event.note}` : '';
  return `${label}${sideText}${gameText}${scoreText}${structuredNote ? '' : noteText}`;
}

function parseRefereeStructuredNote(note?: string | null) {
  if (!note) return null;
  try {
    const parsed = JSON.parse(note) as {
      kind?: string;
      faultType?: string;
      cardType?: 'yellow' | 'red' | 'black';
      reason?: string | null;
    };
    if (parsed.kind === 'BADMINTON_FAULT:') {
      return { label: `违例：${parsed.faultType ?? '未注明'}` };
    }
    if (parsed.kind === 'BADMINTON_CARD:') {
      const cardLabel = parsed.cardType === 'red' ? '红牌' : parsed.cardType === 'black' ? '黑牌' : '黄牌';
      return { label: parsed.reason ? `${cardLabel}：${parsed.reason}` : cardLabel };
    }
  } catch {
    return null;
  }
  return null;
}

function decodeRetireReason(reason?: string | null) {
  if (!reason?.startsWith('RETIRE:')) return null;
  return reason.slice('RETIRE:'.length).trim() || '伤退/退赛';
}

const DEFAULT_WARMUP_MINUTES = 3;
const MIN_WARMUP_MINUTES = 1;
const MAX_WARMUP_MINUTES = 5;

/** seconds 是规定的间歇时长，用来倒计时；手动暂停没有规定时长，改为显示已暂停多久。 */
function pauseAlertText(score?: ScoreState | null): { message: string; description: string; seconds: number | null } {
  if (score?.pauseKind === 'technical') {
    return {
      message: '11 分间歇',
      description: '比赛计时已停止。到时提醒双方回场，点「恢复比赛」继续计分。',
      seconds: 60,
    };
  }
  if (score?.pauseKind === 'interval') {
    return {
      message: `局间休息 · 第 ${score ? currentGameNo(score) : 2} 局前`,
      description: '比赛计时已停止。到时提醒双方回场，点「恢复比赛」开始下一局。',
      seconds: 120,
    };
  }
  return {
    message: score?.pauseReason ? `比赛暂停：${score.pauseReason}` : '比赛暂停中',
    description: '比赛计时已停止，前台同步显示暂停。点「恢复比赛」继续计分。',
    seconds: null,
  };
}

/** 菜单里点了之后要先选「哪一方」的裁判操作，key 对应 ConsoleMenuItem.key。 */
const MENU_REFEREE_ACTIONS: Record<string, Exclude<PendingRefereeAction, null>> = {
  warning: { type: 'WARNING', label: '警告' },
  yellow: { action: 'card', cardType: 'yellow', label: '黄牌' },
  red: { action: 'card', cardType: 'red', label: '红牌' },
  black: { action: 'card', cardType: 'black', label: '黑牌取消资格' },
  serveFault: { action: 'fault', faultType: '发球违例', label: '发球违例' },
  receiveFault: { action: 'fault', faultType: '接发违例', label: '接发违例' },
  netFault: { action: 'fault', faultType: '触网违例', label: '触网违例' },
  timeout: { type: 'TIMEOUT', label: '普通暂停' },
  medical: { type: 'MEDICAL_TIMEOUT', label: '医疗暂停' },
};

const FAULT_TONE = 'border-violet-200 bg-violet-50 text-violet-700';

const PENALTY_MENU: ConsoleMenuSection[] = [
  {
    title: '警告与判罚牌',
    columns: 4,
    items: [
      { key: 'warning', label: '警告', icon: <WarningOutlined />, tone: 'border-orange-200 bg-orange-50 text-orange-700' },
      { key: 'yellow', label: '黄牌', icon: <CardIcon color="#FACC15" />, tone: 'border-yellow-300 bg-yellow-50 text-yellow-800' },
      { key: 'red', label: '红牌', icon: <CardIcon color="#EF4444" />, tone: 'border-red-200 bg-red-50 text-red-700' },
      { key: 'black', label: '黑牌', description: '取消资格', icon: <CardIcon color="#111827" />, tone: 'border-slate-300 bg-slate-50 text-slate-800' },
    ],
  },
  {
    title: '违例',
    columns: 3,
    items: [
      { key: 'serveFault', label: '发球违例', icon: <ExclamationCircleOutlined />, tone: FAULT_TONE },
      { key: 'receiveFault', label: '接发违例', icon: <ExclamationCircleOutlined />, tone: FAULT_TONE },
      { key: 'netFault', label: '触网违例', icon: <ExclamationCircleOutlined />, tone: FAULT_TONE },
    ],
  },
];

const PAUSE_MENU: ConsoleMenuSection[] = [
  {
    columns: 3,
    items: [
      {
        key: 'pause',
        label: '暂停比赛',
        description: '停止计时，前台同步显示',
        icon: <PauseCircleOutlined />,
        tone: 'border-amber-200 bg-amber-50 text-amber-800',
      },
      {
        key: 'timeout',
        label: '普通暂停',
        description: '选择一方并记录',
        icon: <FieldTimeOutlined />,
        tone: 'border-sky-200 bg-sky-50 text-sky-700',
      },
      {
        key: 'medical',
        label: '医疗暂停',
        description: '选择一方并记录',
        icon: <MedicineBoxOutlined />,
        tone: 'border-emerald-200 bg-emerald-50 text-emerald-700',
      },
    ],
  },
];

export default function RefereeScoringPage() {
  const params = useParams<{ matchId: string }>();
  const matchId = params.matchId;
  const { data: session, status: sessionStatus } = useSession();
  const access = useCurrentAccess();
  const canReferee = access.ready && access.can('REFEREE');
  const token = session?.user?.accessToken;
  const [messageApi, messageHolder] = message.useMessage();
  const [score, setScore] = useState<ScoreState | null>(null);
  const [accessRevoked, setAccessRevoked] = useState(false);
  const newestScoreAt = useRef(0);
  const [loading, setLoading] = useState(false);
  const [busyAction, setBusyAction] = useState('');
  const [socketStatus, setSocketStatus] = useState<SocketStatus>('连接中');
  const [forfeitTarget, setForfeitTarget] = useState<1 | 2 | 'both' | null>(null);
  const [forfeitReason, setForfeitReason] = useState('选手未到场弃权');
  const [forfeitChooserOpen, setForfeitChooserOpen] = useState(false);
  const [retireTarget, setRetireTarget] = useState<1 | 2 | null>(null);
  const [retireReason, setRetireReason] = useState('伤退/退赛');
  const [retireChooserOpen, setRetireChooserOpen] = useState(false);
  const [finishConfirmOpen, setFinishConfirmOpen] = useState(false);
  const [startConfirmOpen, setStartConfirmOpen] = useState(false);
  const [startServingSide, setStartServingSide] = useState<1 | 2 | null>(null);
  const [startServerPlayerIndex, setStartServerPlayerIndex] = useState<PlayerIndex | null>(null);
  const [startReceiverPlayerIndex, setStartReceiverPlayerIndex] = useState<PlayerIndex | null>(null);
  const [gameServeOpen, setGameServeOpen] = useState(false);
  const [gameServeServer, setGameServeServer] = useState<PlayerIndex | null>(null);
  const [gameServeReceiver, setGameServeReceiver] = useState<PlayerIndex | null>(null);
  const [pendingRefereeAction, setPendingRefereeAction] = useState<PendingRefereeAction>(null);
  const [consoleMenu, setConsoleMenu] = useState<'penalty' | 'pause' | 'finish' | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [warmupMinutes, setWarmupMinutes] = useState(DEFAULT_WARMUP_MINUTES);
  // 服务器时间减手机时间。倒计时用「手机时间 + 偏差」，手机时钟不准也不会差。
  const [clockOffset, setClockOffset] = useState(0);

  const applyScore = useCallback((nextScore: ScoreState) => {
    const serverNow = Date.parse(nextScore.serverNow ?? '');
    if (serverNow) setClockOffset(serverNow - Date.now());
    const at = Date.parse(nextScore.updatedAt ?? '') || 0;
    if (at < newestScoreAt.current) return;
    newestScoreAt.current = at;
    setScore(nextScore);
  }, []);
  const noLongerAssigned = access.ready && !!score && !access.can('SCORING') && score.referee?.id !== session?.user?.id;

  const winnerName = useMemo(() => {
    if (!score?.winnerSide) return '';
    return score.winnerSide === 1 ? sideName(score.side1) : sideName(score.side2);
  }, [score]);
  const retireReasonText = decodeRetireReason(score?.forfeitReason);
  const pauseAlert = pauseAlertText(score);

  async function loadScore() {
    if (!token || !matchId) return;
    setLoading(true);
    try {
      const data = await apiFetch<ScoreState>(`/matches/${matchId}/score`, { token, redirectOnForbidden: false });
      applyScore(data);
      setAccessRevoked(false);
    } catch (error) {
      if ((error as { status?: number }).status === 403) setAccessRevoked(true);
      messageApi.error(error instanceof Error ? error.message : '加载比分失败');
    } finally {
      setLoading(false);
    }
  }

  /** busyKey 用来区分同一个接口的不同按钮（比如 A、B 两方的 +1），默认就是接口路径。 */
  async function postAction(path: string, body?: Record<string, unknown>, busyKey = path) {
    if (!token || !matchId) return;
    setBusyAction(busyKey);
    try {
      const data = await apiFetch<ScoreState>(path, {
        method: 'POST',
        token,
        redirectOnForbidden: false,
        body: body ? JSON.stringify(body) : undefined,
      });
      applyScore(data);
    } catch (error) {
      if ((error as { status?: number }).status === 403) setAccessRevoked(true);
      messageApi.error(error instanceof Error ? error.message : '操作失败');
    } finally {
      setBusyAction('');
    }
  }

  function openStartConfirm() {
    setStartServingSide(null);
    setStartServerPlayerIndex(null);
    setStartReceiverPlayerIndex(null);
    setStartConfirmOpen(true);
  }

  /**
   * 打开「本局发球设置」。方案 B：新一局的默认发球/接发由系统先带出来，
   * 裁判核对或改选后写回；单打没有可选空间（一方只有一个人），不弹这个窗口。
   */
  function openGameServe() {
    if (!score) return;
    const state = score.servingState;
    setGameServeServer(
      state?.serverPlayerIndex === 1 || state?.serverPlayerIndex === 2
        ? state.serverPlayerIndex
        : null,
    );
    setGameServeReceiver(
      state?.receiverPlayerIndex === 1 || state?.receiverPlayerIndex === 2
        ? state.receiverPlayerIndex
        : null,
    );
    setGameServeOpen(true);
  }

  useEffect(() => {
    newestScoreAt.current = 0;
    loadScore();
  }, [token, matchId]);

  // 比分越过决胜阈值后，自动弹窗请裁判确认结束比赛。
  // 后端此时保持 status=LIVE 并写入 winnerSide（pendingFinish=true），
  // 让我们可以在真正提交前先询问裁判。这里记录已经提示过的 winnerSide，
  // 避免裁判点「取消」后每次 websocket 推送都重复弹窗；
  // 撤销（服务端会清空 winnerSide）后又会重新允许提示。
  const finishPromptedForRef = useRef<number | null>(null);
  useEffect(() => {
    const pending = Boolean(score?.pendingFinish);
    const winner = score?.winnerSide ?? null;
    if (!pending || !winner) {
      finishPromptedForRef.current = null;
      return;
    }
    if (finishPromptedForRef.current !== winner) {
      finishPromptedForRef.current = winner;
      setFinishConfirmOpen(true);
    }
  }, [score?.pendingFinish, score?.winnerSide]);

  // 新一局 0:0 且发球信息还是系统默认值时，主动弹出一次「发球设置」。
  // 方案 B：不拦记分，取消后照常开打，之后随时可以从「更多」或球场上的提示里再打开。
  const servePromptedForRef = useRef<number | null>(null);
  useEffect(() => {
    if (!score || score.status !== 'LIVE') return;
    const state = score.servingState;
    if (state?.source !== 'system') return;
    if (currentSideScore(score, 1) !== 0 || currentSideScore(score, 2) !== 0) return;
    if (!isDoublesSide(score.side1) && !isDoublesSide(score.side2)) return;
    const gameNo = currentGameNo(score);
    if (servePromptedForRef.current === gameNo) return;
    servePromptedForRef.current = gameNo;
    setGameServeServer(
      state.serverPlayerIndex === 1 || state.serverPlayerIndex === 2
        ? state.serverPlayerIndex
        : null,
    );
    setGameServeReceiver(
      state.receiverPlayerIndex === 1 || state.receiverPlayerIndex === 2
        ? state.receiverPlayerIndex
        : null,
    );
    setGameServeOpen(true);
  }, [score]);

  useEffect(() => {
    if (!matchId) return;
    const socket: Socket = io(`${SOCKET_BASE}/scores`, {
      transports: ['polling', 'websocket'],
      withCredentials: true,
    });
    socket.on('connect', () => {
      setSocketStatus('已连接');
      socket.emit('joinMatch', { matchId });
      void loadScore();
    });
    socket.on('disconnect', () => setSocketStatus('已断开'));
    socket.on('match:update', (nextScore: ScoreState) => {
      if (nextScore.id === matchId) applyScore(nextScore);
    });
    return () => {
      socket.emit('leaveMatch', { matchId });
      socket.disconnect();
    };
  }, [matchId, token, applyScore]);

  // 横屏兜底（RefereeLandscapeGate 用 CSS 旋转）时，视口高度要用它给的变量。
  const viewportHeight = { height: 'var(--referee-viewport-height, 100dvh)' };

  if (accessRevoked || noLongerAssigned) {
    const back = score ? courtListHref(score) : '/referee/my-matches';
    return <main className="grid place-items-center bg-slate-50 p-6" style={viewportHeight}>
      <Alert type="info" showIcon title="本场执裁已解除，请重新接手"
        description="比赛成绩已清除或裁判安排已调整。请返回场次列表，重新接手后再开始记分。"
        action={<Button type="primary" href={back}>返回场次列表</Button>} />
    </main>;
  }

  // 只在第一次拿到比分前整页转圈；之后刷新、断线重连都保留当前界面。
  if (sessionStatus === 'loading' || !score) {
    return (
      <div className="grid place-items-center bg-[#F4F6F0]" style={viewportHeight}>
        <Spin />
      </div>
    );
  }

  if (!token || !canReferee) {
    return (
      <main className="grid place-items-center bg-[#F4F6F0] px-5" style={viewportHeight}>
        <div className="max-w-md rounded-2xl border border-[#DDE5DA] bg-white p-6 text-center shadow-xl">
          <h1 className="text-2xl font-black text-[#0B3B2C]">裁判记分</h1>
          <p className="mt-3 text-sm text-[#5D6B63]">请使用裁判账号登录后操作比分。</p>
          <Link
            href={`/login?redirect=${encodeURIComponent(`/referee/matches/${matchId}`)}`}
            className="mt-6 inline-flex h-11 items-center rounded-xl bg-[#0E7A4F] px-6 font-black text-white transition hover:bg-[#0B6A44] active:scale-[0.98]"
          >
            去登录
          </Link>
        </div>
      </main>
    );
  }

  const leftSideNo: 1 | 2 = score.courtDisplayState?.side1CourtSide === 'right' ? 2 : 1;
  const rightSideNo: 1 | 2 = leftSideNo === 1 ? 2 : 1;
  const doublesMatch = isDoublesSide(score.side1) || isDoublesSide(score.side2);
  const servingSideNo = score.servingState?.servingSide === 1 || score.servingState?.servingSide === 2
    ? score.servingState.servingSide
    : null;
  const receivingSideNo = servingSideNo === 1 ? 2 : servingSideNo === 2 ? 1 : null;
  const serveNeedsCheck = doublesMatch
    && score.status === 'LIVE'
    && score.servingState?.source === 'system';
  const serveCheckText = serveNeedsCheck
    ? `第 ${currentGameNo(score)} 局发球为系统默认：`
      + `${playerNameByIndex(servingSideNo === 1 ? score.side1 : score.side2, score.servingState?.serverPlayerIndex)} 发球，`
      + `${playerNameByIndex(receivingSideNo === 1 ? score.side1 : score.side2, score.servingState?.receiverPlayerIndex)} 接发，请核对`
    : '';

  const live = score.status === 'LIVE';
  const matchEnded = score.status === 'COMPLETED' || score.status === 'CANCELLED';
  const paused = live && Boolean(score.matchPaused);
  const busy = busyAction !== '';
  const courtSwapRequired = live && Boolean(score.courtSwapRequired?.required);
  const scoringLocked = !live || paused || courtSwapRequired || Boolean(score.pendingFinish) || busy;
  // 撤销不受「待确认结束」和「需换边」限制：这两种情况下正是要用它改回最后一分。
  const lastPointSide = lastPointSideOf(score);
  const undoLocked = !live || paused || busy || lastPointSide === null;
  const canMinus = (side: 1 | 2) => !undoLocked && lastPointSide === side && currentSideScore(score, side) > 0;
  const backHref = courtListHref(score);
  const undoPath = `/matches/${matchId}/undo`;
  const swapPath = `/matches/${matchId}/swap-court`;
  const pausePath = `/matches/${matchId}/pause`;
  const resumePath = `/matches/${matchId}/resume`;
  const finishPath = `/matches/${matchId}/finish`;
  const forfeitedName = score.forfeitedSide === 1 ? sideName(score.side1) : score.forfeitedSide === 2 ? sideName(score.side2) : '';

  const warmupPath = `/matches/${matchId}/warmup`;
  const warmupEndPath = `/matches/${matchId}/warmup-end`;
  const startAction: CourtOverlayAction = { label: '开始比赛', icon: <PlayCircleOutlined />, run: 'start', disabled: busy };

  const courtOverlay: CourtOverlay | null = score.status === 'PENDING'
    ? score.warmup
      ? {
          tone: 'green',
          title: '赛前练球',
          timer: { startedAt: score.warmup.startedAt, seconds: score.warmup.seconds, warningHint: '请双方准备开始比赛' },
          description: '练球结束后点「开始比赛」，选首发方和发球员。',
          actions: [
            { label: '结束练球', run: 'warmup-end', loading: busyAction === warmupEndPath, disabled: busy, secondary: true },
            startAction,
          ],
        }
      : {
          tone: 'green',
          title: '比赛未开始',
          description: '双方到齐后可先练球再开始比赛；选手未到场请在「结束比赛」里做弃权处理。',
          warmupPicker: true,
          actions: [
            { label: '开始练球', icon: <FieldTimeOutlined />, run: 'warmup', loading: busyAction === warmupPath, disabled: busy, secondary: true },
            startAction,
          ],
        }
    : score.status === 'COMPLETED'
      ? {
          tone: 'green',
          title: winnerName ? `本场已结束 · 胜方：${winnerName}` : '本场已结束',
          description: score.forfeitedSide
            ? `${forfeitedName} ${retireReasonText !== null ? '退赛' : '弃权'}：${retireReasonText ?? score.forfeitReason ?? '选手未到场弃权'}`
            : '计分已锁定。',
          actions: [{ label: '返回场次列表', icon: <ArrowLeftOutlined />, href: backHref }],
        }
      : score.status === 'CANCELLED'
        ? {
            tone: 'red',
            title: '本场已取消',
            description: score.forfeitReason || '计分已锁定。',
            actions: [{ label: '返回场次列表', icon: <ArrowLeftOutlined />, href: backHref }],
          }
        : score.pendingFinish
          ? {
              tone: 'green',
              title: `比分已决出胜方：${winnerName || `${sideLetter(score.winnerSide === 2 ? 2 : 1)}方`}`,
              description: '确认后本场正式结束；如需改最后一分，请点「撤销」或该方的「-1」。',
              actions: [{
                label: '确认结束比赛',
                icon: <FlagOutlined />,
                run: 'finish',
                loading: busyAction === finishPath,
                disabled: busy,
              }],
            }
          : courtSwapRequired
            ? {
                tone: 'amber',
                title: '决胜局 11 分，请交换场地',
                description: '交换后自动进入 60 秒间歇。',
                actions: [{
                  label: '交换场地',
                  icon: <SyncOutlined />,
                  run: 'swap',
                  loading: busyAction === swapPath,
                  disabled: busy,
                }],
              }
            : paused
              ? {
                  tone: 'amber',
                  title: pauseAlert.message,
                  timer: score.pausedAt ? { startedAt: score.pausedAt, seconds: pauseAlert.seconds } : undefined,
                  description: pauseAlert.description,
                  actions: [{
                    label: '恢复比赛',
                    icon: <PlayCircleOutlined />,
                    run: 'resume',
                    loading: busyAction === resumePath,
                    disabled: busy,
                  }],
                }
              : null;

  function runOverlayAction(run: CourtOverlayRun) {
    if (run === 'start') openStartConfirm();
    else if (run === 'finish') setFinishConfirmOpen(true);
    else if (run === 'swap') void postAction(swapPath);
    else if (run === 'warmup') void postAction(warmupPath, { seconds: warmupMinutes * 60 });
    else if (run === 'warmup-end') void postAction(warmupEndPath);
    else void postAction(resumePath);
  }

  const serveNotice = serveNeedsCheck && !courtOverlay ? (
    <div className="absolute left-1/2 top-[0.35em] z-10 flex max-w-[92%] -translate-x-1/2 items-center gap-[0.5em] rounded-full bg-[#FFF6D5] py-[0.2em] pl-[0.9em] pr-[0.25em] text-[0.8em] font-black text-[#7A5200] shadow-[0_6px_14px_rgba(0,0,0,0.18)]">
      <span className="truncate">{serveCheckText}</span>
      <button
        type="button"
        onClick={openGameServe}
        className="shrink-0 rounded-full bg-[#E8A400] px-[0.9em] py-[0.2em] text-white transition active:scale-95"
      >
        核对
      </button>
    </div>
  ) : null;

  const finishMenu: ConsoleMenuSection[] = [
    {
      columns: 3,
      items: [
        {
          key: 'finish',
          label: '确认结束',
          description: score.pendingFinish ? `胜方：${winnerName || '—'}` : '比分尚未决出胜方',
          icon: <FlagOutlined />,
          tone: 'border-emerald-200 bg-emerald-50 text-emerald-800',
          disabled: !score.pendingFinish,
        },
        {
          key: 'forfeit',
          label: '弃权处理',
          description: '未到场 / 双方弃权',
          icon: <CloseCircleOutlined />,
          tone: 'border-red-200 bg-red-50 text-red-700',
        },
        {
          key: 'retire',
          label: '伤退 / 退赛',
          description: '对方判胜',
          icon: <MedicineBoxOutlined />,
          tone: 'border-rose-200 bg-rose-50 text-rose-700',
        },
      ],
    },
  ];
  const menus = {
    penalty: { title: '警告 / 判罚', sections: PENALTY_MENU },
    pause: { title: '暂停', sections: PAUSE_MENU },
    finish: { title: '结束比赛', sections: finishMenu },
  } as const;

  function selectMenuItem(key: string) {
    setConsoleMenu(null);
    const refereeAction = MENU_REFEREE_ACTIONS[key];
    if (refereeAction) setPendingRefereeAction(refereeAction);
    else if (key === 'pause') void postAction(pausePath);
    else if (key === 'finish') setFinishConfirmOpen(true);
    else if (key === 'forfeit') setForfeitChooserOpen(true);
    else if (key === 'retire') setRetireChooserOpen(true);
  }

  const pointPair = (side: 1 | 2) => (
    <div className="mx-auto grid w-full max-w-[28em] grid-cols-2 gap-[0.9em]">
      <PointButton
        kind="plus"
        side={side}
        disabled={scoringLocked}
        loading={busyAction === `point-${side}`}
        onClick={() => void postAction(`/matches/${matchId}/point`, { side }, `point-${side}`)}
      />
      <PointButton
        kind="minus"
        side={side}
        disabled={!canMinus(side)}
        loading={busyAction === `undo-${side}`}
        onClick={() => void postAction(undoPath, { side }, `undo-${side}`)}
      />
    </div>
  );

  return (
    <div
      className="w-full touch-manipulation overflow-hidden bg-[#F4F6F0] text-[#0B3B2C] select-none"
      style={{ ...viewportHeight, containerType: 'size' }}
    >
      {messageHolder}
      <main
        className="flex h-full flex-col"
        style={{
          // 字号跟着可用高度走：手机横屏约 12–14px，平板和电脑最大 22px，其余尺寸都用 em。
          fontSize: 'clamp(12px, min(3.4cqh, 1.9cqw), 22px)',
          paddingLeft: 'var(--referee-safe-left, env(safe-area-inset-left))',
          paddingRight: 'var(--referee-safe-right, env(safe-area-inset-right))',
        }}
      >
        <ConsoleHeader score={score} socketStatus={socketStatus} onOpenMore={() => setMoreOpen(true)} />
        <ScoreStrip score={score} leftSide={leftSideNo} rightSide={rightSideNo} />
        <CourtBoard
          score={score}
          leftSide={leftSideNo}
          rightSide={rightSideNo}
          overlay={courtOverlay}
          clockOffset={clockOffset}
          warmupMinutes={warmupMinutes}
          onWarmupMinutesChange={setWarmupMinutes}
          onOverlayAction={runOverlayAction}
          notice={serveNotice}
        />

        <section className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-[1.2em] px-[1.2em] py-[0.55em]">
          {pointPair(leftSideNo)}
          <span aria-hidden className="h-[2.6em] w-px bg-[#D3DACF]" />
          {pointPair(rightSideNo)}
        </section>

        <nav
          aria-label="裁判操作"
          className="grid shrink-0 grid-cols-5 gap-[0.75em] border-t border-[#E3E8DF] bg-[#FAFBF7] px-[1.2em] pt-[0.55em]"
          style={{ paddingBottom: 'max(0.55em, var(--referee-safe-bottom, env(safe-area-inset-bottom)))' }}
        >
          <ToolButton
            tone="mint"
            icon={<UndoOutlined />}
            label="撤销"
            title="撤销最近一分"
            disabled={undoLocked}
            loading={busyAction === undoPath}
            onClick={() => void postAction(undoPath)}
          />
          <ToolButton
            tone="mint"
            icon={<SyncOutlined />}
            label="交换场地"
            attention={courtSwapRequired}
            disabled={!live || busy}
            loading={busyAction === swapPath}
            onClick={() => void postAction(swapPath)}
          />
          <ToolButton
            tone="amber"
            icon={<CardIcon color="#FACC15" />}
            label="警告/判罚"
            disabled={matchEnded || busy}
            onClick={() => setConsoleMenu('penalty')}
          />
          <ToolButton
            tone="mint"
            icon={paused ? <PlayCircleOutlined /> : <PauseCircleOutlined />}
            label={paused ? '恢复比赛' : '暂停比赛'}
            attention={paused}
            disabled={!live || busy}
            loading={busyAction === pausePath || busyAction === resumePath}
            onClick={() => {
              if (paused) void postAction(resumePath);
              else setConsoleMenu('pause');
            }}
          />
          <ToolButton
            tone="red"
            icon={<FlagOutlined />}
            label="结束比赛"
            attention={Boolean(score.pendingFinish)}
            disabled={matchEnded || busy}
            onClick={() => setConsoleMenu('finish')}
          />
        </nav>
      </main>

      <ConsoleMenuModal
        open={consoleMenu !== null}
        title={consoleMenu ? menus[consoleMenu].title : ''}
        sections={consoleMenu ? menus[consoleMenu].sections : []}
        onSelect={selectMenuItem}
        onClose={() => setConsoleMenu(null)}
      />

      <Drawer open={moreOpen} onClose={() => setMoreOpen(false)} title="比赛详情" placement="right" size={360}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <Link
              href={backHref}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white text-sm font-black text-slate-700 transition active:scale-[0.98]"
            >
              <ArrowLeftOutlined />
              返回场次
            </Link>
            <Button
              icon={<ReloadOutlined />}
              loading={loading}
              onClick={() => void loadScore()}
              className="!h-10 !rounded-xl !font-black"
            >
              刷新比分
            </Button>
            {doublesMatch ? (
              <Button
                icon={<SwapOutlined />}
                disabled={!live || busy}
                onClick={() => {
                  setMoreOpen(false);
                  openGameServe();
                }}
                className={`col-span-2 !h-10 !rounded-xl !font-black ${serveNeedsCheck ? '!border-amber-300 !text-amber-700' : ''}`}
              >
                本局发球设置{serveNeedsCheck ? '（待核对）' : ''}
              </Button>
            ) : null}
          </div>
          <MatchInfoPanel score={score} socketStatus={socketStatus} />
          <GameRecordCard score={score} />
          <EventLogPanel events={score.events.slice(0, 10)} score={score} />
        </div>
      </Drawer>

      <ForfeitChooserModal
        open={forfeitChooserOpen}
        score={score}
        onCancel={() => setForfeitChooserOpen(false)}
        onChoose={(target) => {
          setForfeitReason(target === 'both' ? '双方均未到场，本场作废' : '选手未到场弃权');
          setForfeitTarget(target);
          setForfeitChooserOpen(false);
        }}
      />

      <ForfeitConfirmModal
        open={forfeitTarget !== null}
        target={forfeitTarget}
        score={score}
        matchId={matchId}
        reason={forfeitReason}
        busyAction={busyAction}
        onReasonChange={setForfeitReason}
        onCancel={() => setForfeitTarget(null)}
        onConfirm={async () => {
          if (forfeitTarget === null) return;
          const reason = forfeitReason.trim();
          if (forfeitTarget === 'both') {
            await postAction(`/matches/${matchId}/forfeit-both`, {
              reason: reason || '双方均未到场，本场作废',
            });
          } else {
            await postAction(`/matches/${matchId}/forfeit`, {
              side: forfeitTarget,
              reason: reason || '选手未到场弃权',
            });
          }
          setForfeitTarget(null);
        }}
      />

      <RetireChooserModal
        open={retireChooserOpen}
        score={score}
        onCancel={() => setRetireChooserOpen(false)}
        onChoose={(side) => {
          setRetireReason('伤退/退赛');
          setRetireTarget(side);
          setRetireChooserOpen(false);
        }}
      />

      <RetireConfirmModal
        open={retireTarget !== null}
        target={retireTarget}
        score={score}
        matchId={matchId}
        reason={retireReason}
        busyAction={busyAction}
        onReasonChange={setRetireReason}
        onCancel={() => setRetireTarget(null)}
        onConfirm={async () => {
          if (retireTarget === null) return;
          await postAction(`/matches/${matchId}/retire`, {
            side: retireTarget,
            reason: retireReason.trim() || '伤退/退赛',
          });
          setRetireTarget(null);
        }}
      />

      <RefereeSideActionModal
        open={pendingRefereeAction !== null}
        action={pendingRefereeAction}
        score={score}
        busyAction={busyAction}
        matchId={matchId}
        onCancel={() => setPendingRefereeAction(null)}
        onChoose={async (side) => {
          if (!pendingRefereeAction) return;
          if (pendingRefereeAction.action === 'event' || !('action' in pendingRefereeAction)) {
            await postAction(`/matches/${matchId}/events`, {
              type: pendingRefereeAction.type,
              side,
            });
          } else if (pendingRefereeAction.action === 'fault') {
            await postAction(`/matches/${matchId}/fault`, {
              side,
              faultType: pendingRefereeAction.faultType,
            });
          } else if (pendingRefereeAction.action === 'card') {
            await postAction(`/matches/${matchId}/card`, {
              side,
              cardType: pendingRefereeAction.cardType,
              reason: pendingRefereeAction.label,
            });
          }
          setPendingRefereeAction(null);
        }}
      />

      <StartMatchConfirmModal
        open={startConfirmOpen}
        score={score}
        matchId={matchId}
        busyAction={busyAction}
        servingSide={startServingSide}
        serverPlayerIndex={startServerPlayerIndex}
        receiverPlayerIndex={startReceiverPlayerIndex}
        onServingSideChange={(side) => {
          setStartServingSide(side);
          const players = sidePlayers(side === 1 ? score.side1 : score.side2);
          const receiverPlayers = sidePlayers(side === 1 ? score.side2 : score.side1);
          setStartServerPlayerIndex(players.length === 1 ? 1 : null);
          setStartReceiverPlayerIndex(receiverPlayers.length === 1 ? 1 : null);
        }}
        onServerPlayerChange={setStartServerPlayerIndex}
        onReceiverPlayerChange={setStartReceiverPlayerIndex}
        onCancel={() => setStartConfirmOpen(false)}
        onConfirm={async () => {
          if (!startServingSide || !startServerPlayerIndex || !startReceiverPlayerIndex) {
            messageApi.warning('请先选择首发方、首位发球员和接发球员');
            return;
          }
          await postAction(`/matches/${matchId}/start`, {
            servingSide: startServingSide,
            serverPlayerIndex: startServerPlayerIndex,
            receiverPlayerIndex: startReceiverPlayerIndex,
          });
          setStartConfirmOpen(false);
        }}
      />

      <GameServeModal
        open={gameServeOpen}
        score={score}
        matchId={matchId}
        busyAction={busyAction}
        serverPlayerIndex={gameServeServer}
        receiverPlayerIndex={gameServeReceiver}
        onServerPlayerChange={setGameServeServer}
        onReceiverPlayerChange={setGameServeReceiver}
        onCancel={() => setGameServeOpen(false)}
        onConfirm={async () => {
          if (!gameServeServer || !gameServeReceiver) {
            messageApi.warning('请先选择本局的发球员和接发球员');
            return;
          }
          await postAction(`/matches/${matchId}/game-serve`, {
            gameNo: currentGameNo(score),
            serverPlayerIndex: gameServeServer,
            receiverPlayerIndex: gameServeReceiver,
          });
          setGameServeOpen(false);
        }}
      />

      <Modal
        open={finishConfirmOpen}
        title="确认结束比赛"
        okText="确认结束"
        cancelText="再看看"
        okButtonProps={{ danger: true, loading: busyAction === finishPath }}
        onCancel={() => setFinishConfirmOpen(false)}
        onOk={async () => {
          await postAction(finishPath);
          setFinishConfirmOpen(false);
        }}
      >
        <div className="space-y-3">
          <p className="text-sm font-semibold text-slate-700">
            比分已决出胜方:<strong className="text-emerald-600">{winnerName || `选手 ${score.winnerSide ?? ''}`}</strong>。确认后本场比赛将正式结束,无法继续计分。
          </p>
          <Alert
            type="info"
            showIcon
            title="如需修改本场最后一分,请点击「再看看」后使用「撤销」或该方的「-1」回退,再继续比赛。"
          />
        </div>
      </Modal>
    </div>
  );
}

function ConsoleHeader({
  score,
  socketStatus,
  onOpenMore,
}: {
  score: ScoreState;
  socketStatus: SocketStatus;
  onOpenMore: () => void;
}) {
  const paused = score.status === 'LIVE' && Boolean(score.matchPaused);
  const syncTone = socketStatus === '已连接' ? 'bg-emerald-500' : socketStatus === '连接中' ? 'bg-sky-500' : 'bg-red-500';

  return (
    <header className="flex shrink-0 items-center justify-between gap-[1em] border-b border-[#E3E8DF] bg-[#FAFBF7] px-[1.2em] py-[0.45em]">
      <div className="flex min-w-0 items-center gap-[0.7em]">
        <Image
          src="/logo-mark.png"
          alt="羽动云赛"
          width={256}
          height={256}
          priority
          className="h-[2.2em] w-[2.2em] shrink-0 object-contain"
        />
        <span className="shrink-0 text-[1.3em] font-black tracking-wide text-[#0B3B2C]">羽动云赛</span>
        <span aria-hidden className="h-[1.2em] w-px shrink-0 bg-[#C8D0C5]" />
        <span className="shrink-0 text-[1.05em] font-bold text-[#56665D]">裁判端</span>
      </div>

      <div className="flex min-w-0 items-center gap-[0.8em]">
        <span className="truncate text-[1.05em] font-black text-[#0B3B2C]">
          {score.event.typeLabel} · {score.venue?.name ?? '未排场地'}
        </span>
        <span aria-hidden className="h-[1.2em] w-px shrink-0 bg-[#C8D0C5]" />
        <MatchClock
          startedAt={score.startedAt}
          finishedAt={score.finishedAt}
          status={score.status}
          matchPaused={score.matchPaused}
          actualDurationSeconds={score.actualDurationSeconds}
          className={`inline-flex shrink-0 items-center gap-[0.3em] text-[0.95em] font-black ${paused ? 'text-amber-600' : 'text-[#2F5D4C]'}`}
        />
        <span
          role="status"
          title={`实时同步：${socketStatus}`}
          className="inline-flex shrink-0 items-center gap-[0.3em] text-[0.85em] font-bold text-red-600"
        >
          <span className={`h-[0.6em] w-[0.6em] rounded-full ${syncTone}`} />
          {socketStatus === '已断开' ? '同步已断开' : null}
        </span>
        <span className="shrink-0 rounded-[0.55em] bg-[#DDEFE4] px-[0.75em] py-[0.25em] text-[1.05em] font-black text-[#0B3B2C]">
          第{currentGameNo(score)}局
        </span>
        <button
          type="button"
          aria-label="比赛详情与更多操作"
          onClick={onOpenMore}
          className="grid h-[2.1em] w-[2.1em] shrink-0 place-items-center rounded-[0.55em] border border-[#D5DDD2] bg-white text-[1.05em] text-[#2F5D4C] transition active:scale-95"
        >
          <MenuOutlined />
        </button>
      </div>
    </header>
  );
}

function ScoreStrip({ score, leftSide, rightSide }: { score: ScoreState; leftSide: 1 | 2; rightSide: 1 | 2 }) {
  const gamesWon = (side: 1 | 2) => (side === 1 ? score.side1Games : score.side2Games);

  return (
    <section className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center px-[1.2em] py-[0.35em]">
      <SideScore side={leftSide} value={currentSideScore(score, leftSide)} />
      <div className="flex items-center self-stretch">
        <span aria-hidden className="my-[0.5em] w-px self-stretch bg-[#D3DACF]" />
        <div className="px-[3em] text-center">
          <p className="text-[1em] font-black text-[#1E3E33]">大比分</p>
          <p className="mt-[0.1em] whitespace-nowrap text-[clamp(1.6rem,7.5cqh,5.5rem)] font-black leading-none tabular-nums text-[#0B3B2C]">
            {gamesWon(leftSide)} : {gamesWon(rightSide)}
          </p>
        </div>
        <span aria-hidden className="my-[0.5em] w-px self-stretch bg-[#D3DACF]" />
      </div>
      <SideScore side={rightSide} value={currentSideScore(score, rightSide)} />
    </section>
  );
}

function SideScore({ side, value }: { side: 1 | 2; value: number }) {
  return (
    <div className="min-w-0 text-center">
      <p className="truncate text-[1em] font-black text-[#1E3E33]">{sideLetter(side)}方 · 本局得分</p>
      <strong className="block text-[clamp(2.4rem,12.5cqh,9rem)] font-black leading-[0.95] tracking-tight tabular-nums text-[#0B3B2C]">
        {value}
      </strong>
    </div>
  );
}

type CourtOverlayRun = 'start' | 'finish' | 'swap' | 'resume' | 'warmup' | 'warmup-end';

/** 按钮要么跳转（href），要么交给页面按 run 执行；secondary 是描边的次要按钮。 */
type CourtOverlayAction = {
  label: string;
  icon?: ReactNode;
  href?: string;
  run?: CourtOverlayRun;
  loading?: boolean;
  disabled?: boolean;
  secondary?: boolean;
};

/** seconds 为空表示没有规定时长，只显示已经过去多久；warningHint 是最后 20 秒的提示。 */
type CourtOverlayTimer = { startedAt: string; seconds: number | null; warningHint?: string };

/** 球场上的状态提示层。 */
type CourtOverlay = {
  tone: 'green' | 'amber' | 'red';
  title: string;
  timer?: CourtOverlayTimer;
  description?: string;
  /** 显示练球时长的加减按钮。 */
  warmupPicker?: boolean;
  actions: CourtOverlayAction[];
};

const overlayTitleTone: Record<CourtOverlay['tone'], string> = {
  green: 'text-[#0B5D3B]',
  amber: 'text-[#9A5B00]',
  red: 'text-[#C62828]',
};

function CourtBoard({
  score,
  leftSide,
  rightSide,
  overlay,
  clockOffset,
  warmupMinutes,
  onWarmupMinutesChange,
  onOverlayAction,
  notice,
}: {
  score: ScoreState;
  leftSide: 1 | 2;
  rightSide: 1 | 2;
  overlay: CourtOverlay | null;
  clockOffset: number;
  warmupMinutes: number;
  onWarmupMinutesChange: (minutes: number) => void;
  onOverlayAction: (run: CourtOverlayRun) => void;
  notice: ReactNode;
}) {
  return (
    <section className="relative min-h-0 flex-1 bg-[#12865A] px-[1.4em] py-[0.9em]">
      <div className="relative h-full w-full">
        <div aria-hidden className="pointer-events-none absolute inset-0 rounded-[0.35em] border-[3px] border-white/90" />
        <CourtLines />
        <CourtNet />
        <CourtTeam score={score} side={leftSide} display="left" />
        <CourtTeam score={score} side={rightSide} display="right" />
      </div>
      {notice}
      {overlay ? (
        <CourtOverlayCard
          overlay={overlay}
          clockOffset={clockOffset}
          warmupMinutes={warmupMinutes}
          onWarmupMinutesChange={onWarmupMinutesChange}
          onAction={onOverlayAction}
        />
      ) : null}
    </section>
  );
}

// 场地线按示意比例画（不是严格的 13.4m × 6.1m），给球员卡留出空间：
// 单打边线离边 8.7%，双打后发球线离底线 4.6%，前发球线离网 5%。
function CourtLines() {
  const lines: Array<[number, number, number, number]> = [
    [0, 87, 1000, 87],
    [0, 913, 1000, 913],
    [46, 0, 46, 1000],
    [954, 0, 954, 1000],
    [450, 0, 450, 1000],
    [550, 0, 550, 1000],
    [0, 500, 450, 500],
    [550, 500, 1000, 500],
  ];
  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox="0 0 1000 1000"
      preserveAspectRatio="none"
    >
      {lines.map(([x1, y1, x2, y2]) => (
        <line
          key={`${x1}-${y1}-${x2}-${y2}`}
          x1={x1}
          y1={y1}
          x2={x2}
          y2={y2}
          stroke="rgba(255,255,255,0.9)"
          strokeWidth={3}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}

function CourtNet() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute -bottom-[0.6em] -top-[0.6em] left-1/2 z-[1] flex w-[0.8em] -translate-x-1/2 flex-col items-center"
    >
      <span className="h-[0.7em] w-full shrink-0 rounded-[0.2em] bg-white shadow" />
      <span
        className="w-[0.5em] flex-1 border-x border-white/80"
        style={{
          background:
            'repeating-linear-gradient(0deg, rgba(255,255,255,0.4) 0 1px, transparent 1px 4px),'
            + ' repeating-linear-gradient(90deg, rgba(255,255,255,0.4) 0 1px, transparent 1px 4px), #12251D',
        }}
      />
      <span className="h-[0.7em] w-full shrink-0 rounded-[0.2em] bg-white shadow" />
    </div>
  );
}

/**
 * 每个球员站在哪个发球区。双打按服务端的站位；单打两人都站在与发球员同名的发球区
 * （本方比分偶数在右、奇数在左）。
 */
function sideCourtSlots(score: ScoreState, side: 1 | 2): Record<CourtSide, SidePlayer | null> {
  const players = sidePlayers(side === 1 ? score.side1 : score.side2);
  const state = score.servingState;
  if (players.length < 2) {
    return state?.serverCourtSide === 'left'
      ? { left: players[0], right: null }
      : { left: null, right: players[0] };
  }
  const positions = side === 1 ? state?.side1Positions : state?.side2Positions;
  const byIndex = (index?: PlayerIndex | null) => players.find((player) => player.index === index) ?? null;
  const right = byIndex(positions?.right);
  const left = byIndex(positions?.left);
  if (right && left) return { right, left };
  return { right: players[0], left: players[1] };
}

function playerRole(score: ScoreState, side: 1 | 2, playerIndex: number): 'server' | 'receiver' | null {
  const state = score.servingState;
  if (score.status !== 'LIVE' || !state) return null;
  if (state.servingSide === side && state.serverPlayerIndex === playerIndex) return 'server';
  if (state.receivingSide === side && state.receiverPlayerIndex === playerIndex) return 'receiver';
  return null;
}

/**
 * 俯视球场：左边一方面朝右，他的右发球区在下半场；右边一方面朝左，右发球区在上半场。
 * 这样发球员和接发球员正好落在对角线上。
 */
function CourtTeam({ score, side, display }: { score: ScoreState; side: 1 | 2; display: 'left' | 'right' }) {
  const slots = sideCourtSlots(score, side);
  return (
    <>
      {(['right', 'left'] as const).map((courtSide) => {
        const player = slots[courtSide];
        if (!player) return null;
        const top = display === 'left' ? courtSide === 'left' : courtSide === 'right';
        return (
          <div
            key={courtSide}
            className={`absolute z-[2] flex items-center ${
              display === 'left'
                ? 'left-[4.6%] right-[55%] justify-end pr-[1.5%]'
                : 'left-[55%] right-[4.6%] justify-start pl-[1.5%]'
            } ${top ? 'top-[8.7%] bottom-1/2' : 'top-1/2 bottom-[8.7%]'}`}
          >
            <CourtPlayerCard player={player} role={playerRole(score, side, player.index)} />
          </div>
        );
      })}
    </>
  );
}

function CourtPlayerCard({ player, role }: { player: SidePlayer; role: 'server' | 'receiver' | null }) {
  const gender = genderLabel(player.gender);
  const detail = gender ? `性别：${gender}` : player.affiliation || '';
  return (
    <div
      className={`flex max-h-full w-[82%] min-w-0 max-w-[19em] items-center gap-[0.65em] overflow-hidden rounded-[0.75em] border px-[0.75em] py-[0.5em] shadow-[0_8px_18px_rgba(0,0,0,0.12)] ${
        role ? 'border-white/25 bg-[#0A5C3C]/90' : 'border-white/10 bg-[#0A5C3C]/70'
      }`}
      style={{ fontSize: 'clamp(10px, 3.3cqh, 24px)' }}
    >
      <span className="grid h-[2.2em] w-[2.2em] shrink-0 place-items-center rounded-full bg-white/20 text-[1.1em] font-black text-white">
        {Array.from(player.name)[0] ?? '?'}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[1.2em] font-black leading-tight text-white">{player.name}</span>
        {detail ? <span className="mt-[0.15em] block truncate text-[0.85em] font-bold text-white/70">{detail}</span> : null}
      </span>
      {role ? (
        <span
          className={`shrink-0 self-start rounded-full px-[0.7em] py-[0.2em] text-[0.8em] font-black ${
            role === 'server' ? 'bg-[#FFD43B] text-[#4A3500]' : 'bg-[#D7F5C8] text-[#0E5A36]'
          }`}
        >
          {role === 'server' ? '发球' : '接发球'}
        </span>
      ) : null}
    </div>
  );
}

function CourtOverlayCard({
  overlay,
  clockOffset,
  warmupMinutes,
  onWarmupMinutesChange,
  onAction,
}: {
  overlay: CourtOverlay;
  clockOffset: number;
  warmupMinutes: number;
  onWarmupMinutesChange: (minutes: number) => void;
  onAction: (run: CourtOverlayRun) => void;
}) {
  return (
    <div className="absolute inset-0 z-20 grid place-items-center overflow-auto bg-[#04301F]/60 p-[0.6em]">
      <div role="status" className="w-full max-w-[30em] rounded-[0.9em] bg-white px-[1.3em] py-[0.8em] text-center shadow-[0_18px_40px_rgba(0,0,0,0.25)]">
        <div className="flex flex-wrap items-center justify-center gap-x-[0.8em] gap-y-[0.2em]">
          <p className={`text-[1.2em] font-black leading-tight ${overlayTitleTone[overlay.tone]}`}>{overlay.title}</p>
          {overlay.timer ? <OverlayTimer timer={overlay.timer} clockOffset={clockOffset} /> : null}
        </div>
        {overlay.description ? (
          <p className="mt-[0.35em] line-clamp-2 text-[0.85em] font-semibold leading-snug text-[#5D6B63]">{overlay.description}</p>
        ) : null}
        <div className="mt-[0.7em] flex flex-wrap items-center justify-center gap-[0.6em]">
          {overlay.warmupPicker ? <WarmupMinutesPicker value={warmupMinutes} onChange={onWarmupMinutesChange} /> : null}
          {overlay.actions.map((action) => (
            <OverlayActionButton key={action.label} action={action} onAction={onAction} />
          ))}
        </div>
      </div>
    </div>
  );
}

function OverlayActionButton({ action, onAction }: { action: CourtOverlayAction; onAction: (run: CourtOverlayRun) => void }) {
  const { run } = action;
  const className = `inline-flex h-[2.5em] items-center justify-center gap-[0.45em] rounded-[0.65em] px-[1.2em] text-[1em] font-black transition active:scale-[0.98] disabled:cursor-not-allowed ${
    action.secondary
      ? 'border-[1.5px] border-[#0E7A4F] bg-white text-[#0E7A4F] disabled:border-[#B9CCC1] disabled:text-[#9DB5A8]'
      : 'bg-[#0E7A4F] text-white shadow-[0_8px_18px_rgba(14,122,79,0.3)] disabled:bg-[#9DB5A8] disabled:shadow-none'
  }`;
  if (action.href) {
    return (
      <Link href={action.href} className={className}>
        {action.icon}
        {action.label}
      </Link>
    );
  }
  if (!run) return null;
  return (
    <button type="button" onClick={() => onAction(run)} disabled={action.disabled || action.loading} className={className}>
      {action.loading ? <LoadingOutlined /> : action.icon}
      {action.label}
    </button>
  );
}

function WarmupMinutesPicker({ value, onChange }: { value: number; onChange: (minutes: number) => void }) {
  const stepClass = 'grid h-full w-[2.1em] place-items-center text-[1.15em] font-black transition active:scale-90 disabled:cursor-not-allowed disabled:text-[#B5C4BB]';
  return (
    <span className="inline-flex h-[2.5em] items-center rounded-[0.65em] border border-[#CFE3D8] bg-[#F3FAF6] text-[#0B3B2C]">
      <button
        type="button"
        aria-label="练球时间减 1 分钟"
        disabled={value <= MIN_WARMUP_MINUTES}
        onClick={() => onChange(value - 1)}
        className={stepClass}
      >
        −
      </button>
      <span className="whitespace-nowrap text-[0.95em] font-black tabular-nums">练球 {value} 分钟</span>
      <button
        type="button"
        aria-label="练球时间加 1 分钟"
        disabled={value >= MAX_WARMUP_MINUTES}
        onClick={() => onChange(value + 1)}
        className={stepClass}
      >
        +
      </button>
    </span>
  );
}

// 规则上间歇剩 20 秒时裁判要提醒双方回场，倒计时到这里变色。
const TIMER_WARNING_SECONDS = 20;

function formatSeconds(seconds: number) {
  const mm = Math.floor(seconds / 60).toString().padStart(2, '0');
  const ss = (seconds % 60).toString().padStart(2, '0');
  return `${mm}:${ss}`;
}

/** 每隔 intervalMs 重新渲染一次，返回当前手机时间。 */
function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const handle = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(handle);
  }, [intervalMs]);
  return now;
}

function OverlayTimer({ timer, clockOffset }: { timer: CourtOverlayTimer; clockOffset: number }) {
  const now = useNow(500) + clockOffset;
  const elapsed = Math.max(0, Math.floor((now - Date.parse(timer.startedAt)) / 1000));

  if (timer.seconds === null) {
    return (
      <span className="whitespace-nowrap text-[1.2em] font-black tabular-nums text-[#9A5B00]">
        已暂停 {formatSeconds(elapsed)}
      </span>
    );
  }

  const remaining = timer.seconds - elapsed;
  const timeUp = remaining <= 0;
  const warning = !timeUp && remaining <= TIMER_WARNING_SECONDS;
  return (
    <span className="inline-flex items-center gap-[0.5em]" aria-live="polite">
      <span
        className={`text-[2.2em] font-black leading-none tabular-nums ${
          timeUp ? 'text-[#C62828]' : warning ? 'text-[#D97706]' : 'text-[#0B3B2C]'
        }`}
      >
        {formatSeconds(Math.max(0, remaining))}
      </span>
      {timeUp ? (
        <span className="whitespace-nowrap rounded-full bg-[#FDECEC] px-[0.65em] py-[0.15em] text-[0.8em] font-black text-[#C62828]">
          时间到 · 已超 {formatSeconds(-remaining)}
        </span>
      ) : warning ? (
        <span className="whitespace-nowrap rounded-full bg-[#FFF3DC] px-[0.65em] py-[0.15em] text-[0.8em] font-black text-[#B45309]">
          {timer.warningHint ?? '请提醒双方回场'}
        </span>
      ) : null}
    </span>
  );
}

function PointButton({
  kind,
  side,
  disabled,
  loading,
  onClick,
}: {
  kind: 'plus' | 'minus';
  side: 1 | 2;
  disabled: boolean;
  loading: boolean;
  onClick: () => void;
}) {
  const plus = kind === 'plus';
  return (
    <button
      type="button"
      aria-label={`${sideLetter(side)}方 ${plus ? '+1 得分' : '-1 减分'}`}
      aria-busy={loading}
      disabled={disabled && !loading}
      onClick={loading ? undefined : onClick}
      className={`flex h-[clamp(38px,10.5cqh,92px)] min-w-0 items-center justify-center gap-[0.45em] rounded-[0.7em] font-black text-[#0B3B2C] transition active:scale-[0.98] disabled:cursor-not-allowed ${
        plus
          ? 'bg-[#DFF57C] shadow-[0_6px_14px_rgba(132,170,20,0.25)] disabled:bg-[#ECEFE8] disabled:text-[#A9B3AC] disabled:shadow-none'
          : 'border-[1.5px] border-[#24463A] bg-white disabled:border-[#D8DDD5] disabled:text-[#B5BEB8]'
      }`}
    >
      {loading ? (
        <LoadingOutlined className="text-[1.5em]" />
      ) : (
        <span className="text-[1.9em] leading-none tracking-tight">{plus ? '+1' : '-1'}</span>
      )}
      <span className="text-[1.15em]">{plus ? '得分' : '减分'}</span>
    </button>
  );
}

const toolTones = {
  mint: 'border-[#A8D8C4] bg-[#ECF7F2] text-[#0F3B2E]',
  amber: 'border-[#F2C661] bg-[#FFF5D9] text-[#8A5300]',
  red: 'border-[#F1B2B2] bg-[#FDEEEE] text-[#C62828]',
} as const;

function ToolButton({
  tone,
  icon,
  label,
  title,
  attention = false,
  disabled = false,
  loading = false,
  onClick,
}: {
  tone: keyof typeof toolTones;
  icon: ReactNode;
  label: string;
  title?: string;
  attention?: boolean;
  disabled?: boolean;
  loading?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title ?? label}
      aria-busy={loading}
      disabled={disabled && !loading}
      onClick={loading ? undefined : onClick}
      className={`flex h-[clamp(38px,10cqh,84px)] min-w-0 items-center justify-center gap-[0.5em] rounded-[0.7em] border-[1.5px] px-[0.5em] font-black transition active:scale-[0.98] disabled:cursor-not-allowed disabled:border-[#E2E6DF] disabled:bg-[#F3F5F1] disabled:text-[#B3BCB6] ${toolTones[tone]} ${
        attention ? 'ring-[3px] ring-[#F59E0B]/70' : ''
      }`}
    >
      <span className="shrink-0 text-[1.35em] leading-none">{loading ? <LoadingOutlined /> : icon}</span>
      <span className="truncate text-[1.05em]">{label}</span>
    </button>
  );
}

function CardIcon({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      className="inline-block h-[1em] w-[0.72em] rounded-[0.14em] align-middle shadow-[inset_0_0_0_1px_rgba(0,0,0,0.2)]"
      style={{ background: color }}
    />
  );
}

type ConsoleMenuItem = {
  key: string;
  label: string;
  description?: string;
  icon: ReactNode;
  tone: string;
  disabled?: boolean;
};

type ConsoleMenuSection = { title?: string; columns: 3 | 4; items: ConsoleMenuItem[] };

/** 底部「警告/判罚」「暂停比赛」「结束比赛」弹出的选项面板。 */
function ConsoleMenuModal({
  open,
  title,
  sections,
  onSelect,
  onClose,
}: {
  open: boolean;
  title: string;
  sections: ConsoleMenuSection[];
  onSelect: (key: string) => void;
  onClose: () => void;
}) {
  return (
    <Modal open={open} title={title} footer={null} centered width={560} onCancel={onClose}>
      <div className="space-y-3">
        {sections.map((section, index) => (
          <div key={section.title ?? index}>
            {section.title ? <p className="mb-1.5 text-xs font-black text-slate-500">{section.title}</p> : null}
            <div className={`grid gap-2 ${section.columns === 4 ? 'grid-cols-4' : 'grid-cols-3'}`}>
              {section.items.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  disabled={item.disabled}
                  onClick={() => onSelect(item.key)}
                  className={`flex min-h-[64px] min-w-0 flex-col items-center justify-center gap-1 rounded-xl border px-2 py-2 text-center transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 ${item.tone}`}
                >
                  <span className="text-xl leading-none">{item.icon}</span>
                  <span className="text-sm font-black">{item.label}</span>
                  {item.description ? (
                    <span className="line-clamp-2 text-[11px] font-semibold leading-tight opacity-75">{item.description}</span>
                  ) : null}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

function GameRecordCard({ score }: { score: ScoreState }) {
  const paused = score.matchPaused && score.status === 'LIVE';

  return (
    <section>
      <h2 className="text-sm font-black text-[#0F172A]">局分记录（A : B）</h2>
      <div className="mt-2 space-y-2">
        {recordItems(score).map((game) => {
          const statusText = game.winnerSide
            ? `胜方 ${sideLetter(game.winnerSide === 2 ? 2 : 1)}方`
            : game.active ? (paused ? '暂停中' : '进行中') : '未开始';
          return (
            <div
              key={game.gameNo}
              className={`grid grid-cols-[64px_minmax(0,1fr)_72px] items-center gap-2 rounded-xl border px-3 py-2 ${
                game.active ? 'border-emerald-200 bg-emerald-50/80' : 'border-slate-100 bg-slate-50/70'
              }`}
            >
              <span className={`text-sm font-black ${game.active ? 'text-emerald-700' : 'text-slate-600'}`}>
                第{game.gameNo}局
              </span>
              <strong className="text-center text-lg font-black text-[#0F172A]">
                {game.side1Score} <span className="text-slate-300">:</span> {game.side2Score}
              </strong>
              <span className={`text-right text-[11px] font-black ${game.active ? 'text-emerald-700' : 'text-slate-400'}`}>
                {statusText}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function MatchInfoPanel({ score, socketStatus }: { score: ScoreState; socketStatus: SocketStatus }) {
  const items: Array<[string, ReactNode]> = [
    ['赛事', score.event.tournament?.name ?? '—'],
    ['场次', `${score.event.typeLabel} · ${score.round} · 第 ${score.matchNo} 场`],
    ['计分规则', formatScoringRule(score.event).label],
    ['A 方', sideDisplayName(score.side1)],
    ['B 方', sideDisplayName(score.side2)],
    ['比赛状态', score.matchPaused && score.status === 'LIVE' ? '比赛暂停' : statusLabels[score.status]],
    ['计划时间', formatDateTime(score.scheduledAt)],
    ['场地', score.venue?.name ?? '未排场地'],
    [
      '比赛用时',
      score.startedAt ? (
        <MatchClock
          startedAt={score.startedAt}
          finishedAt={score.finishedAt}
          status={score.status}
          matchPaused={score.matchPaused}
          actualDurationSeconds={score.actualDurationSeconds}
          className="inline-flex items-center gap-1"
        />
      ) : '未开始',
    ],
    ['实时同步', socketStatus],
  ];

  return (
    <section>
      <h2 className="text-sm font-black text-[#0F172A]">比赛信息</h2>
      <dl className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-100 bg-slate-50/60">
        {items.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-3 px-3 py-2">
            <dt className="shrink-0 text-xs font-bold text-slate-500">{label}</dt>
            <dd className="min-w-0 truncate text-right text-sm font-black text-[#0F172A]">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function RefereeSideActionModal({
  open,
  action,
  score,
  busyAction,
  matchId,
  onCancel,
  onChoose,
}: {
  open: boolean;
  action: PendingRefereeAction;
  score: ScoreState;
  busyAction: string;
  matchId: string;
  onCancel: () => void;
  onChoose: (side: 1 | 2) => void;
}) {
  const actionPath = action?.action === 'fault'
    ? `/matches/${matchId}/fault`
    : action?.action === 'card'
      ? `/matches/${matchId}/card`
      : `/matches/${matchId}/events`;
  const loading = busyAction === actionPath;

  return (
    <Modal
      open={open}
      title={action ? `${action.label} · 选择选手` : '选择选手'}
      footer={null}
      onCancel={onCancel}
    >
      <div className="space-y-3">
        <Alert
          type="info"
          showIcon
          message="请选择本次裁判操作对应的选手或组合"
          description="确认后会记录操作时间，并同步显示到前端对阵表的比赛记录中。"
        />
        <div className="grid gap-3">
          <Button
            className="!h-12 !rounded-xl !font-black"
            loading={loading}
            disabled={!score.side1 || loading}
            onClick={() => onChoose(1)}
          >
            {sideName(score.side1)}
          </Button>
          <Button
            className="!h-12 !rounded-xl !font-black"
            loading={loading}
            disabled={!score.side2 || loading}
            onClick={() => onChoose(2)}
          >
            {sideName(score.side2)}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function StartMatchConfirmModal({
  open,
  score,
  matchId,
  busyAction,
  servingSide,
  serverPlayerIndex,
  receiverPlayerIndex,
  onServingSideChange,
  onServerPlayerChange,
  onReceiverPlayerChange,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  score: ScoreState;
  matchId: string;
  busyAction: string;
  servingSide: 1 | 2 | null;
  serverPlayerIndex: PlayerIndex | null;
  receiverPlayerIndex: PlayerIndex | null;
  onServingSideChange: (side: 1 | 2) => void;
  onServerPlayerChange: (playerIndex: PlayerIndex) => void;
  onReceiverPlayerChange: (playerIndex: PlayerIndex) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const selectedSide = servingSide === 1 ? score.side1 : servingSide === 2 ? score.side2 : null;
  const receivingSide = servingSide === 1 ? 2 : servingSide === 2 ? 1 : null;
  const selectedReceivingSide = receivingSide === 1 ? score.side1 : receivingSide === 2 ? score.side2 : null;

  return (
    <Modal
      open={open}
      title="确认开始比赛"
      okText="双方已到齐，开始比赛"
      cancelText="暂不开始"
      okButtonProps={{
        loading: busyAction === `/matches/${matchId}/start`,
        disabled: score.status !== 'PENDING' || !servingSide || !serverPlayerIndex || !receiverPlayerIndex,
      }}
      onCancel={onCancel}
      onOk={onConfirm}
    >
      <div className="space-y-3">
        <Alert
          type="info"
          showIcon
          message="请确认双方选手是否到齐"
          description="确认双方到齐后，请选择首发方、首位发球员和接发球员。0:0 开局两人都在各自右发球区，站位由这两项自动排定。"
        />
        <div className="grid gap-2 text-sm font-semibold text-slate-700">
          <div className="rounded-xl border border-blue-100 bg-blue-50/60 px-4 py-3">
            <span className="text-slate-500">左侧：</span>
            <strong className="text-[#0F172A]">{sideDisplayName(score.side1)}</strong>
            {isDoublesSide(score.side1) ? <p className="mt-1 text-xs text-slate-500">{sidePlayers(score.side1).map((player) => player.name).join(' / ')}</p> : null}
          </div>
          <div className="rounded-xl border border-red-100 bg-red-50/60 px-4 py-3">
            <span className="text-slate-500">右侧：</span>
            <strong className="text-[#0F172A]">{sideDisplayName(score.side2)}</strong>
            {isDoublesSide(score.side2) ? <p className="mt-1 text-xs text-slate-500">{sidePlayers(score.side2).map((player) => player.name).join(' / ')}</p> : null}
          </div>
        </div>
        <div>
          <p className="mb-2 text-sm font-black text-slate-700">首发方</p>
          <div className="grid grid-cols-2 gap-2">
            <Button
              className={`!h-11 !rounded-xl !font-black ${servingSide === 1 ? '!border-blue-500 !bg-blue-50 !text-blue-700' : ''}`}
              onClick={() => onServingSideChange(1)}
            >
              {sideDisplayName(score.side1)}
            </Button>
            <Button
              className={`!h-11 !rounded-xl !font-black ${servingSide === 2 ? '!border-red-500 !bg-red-50 !text-red-700' : ''}`}
              onClick={() => onServingSideChange(2)}
            >
              {sideDisplayName(score.side2)}
            </Button>
          </div>
        </div>
        {servingSide ? (
          <div>
            <p className="mb-2 text-sm font-black text-slate-700">首位发球员</p>
            <PickPlayerButtons
              candidates={sidePlayers(selectedSide)}
              selectedIndex={serverPlayerIndex}
              tone="emerald"
              onPick={onServerPlayerChange}
            />
          </div>
        ) : null}
        {receivingSide ? (
          <div>
            <p className="mb-2 text-sm font-black text-slate-700">接发球员</p>
            <PickPlayerButtons
              candidates={sidePlayers(selectedReceivingSide)}
              selectedIndex={receiverPlayerIndex}
              tone="orange"
              onPick={onReceiverPlayerChange}
            />
          </div>
        ) : null}
        {servingSide && serverPlayerIndex && receiverPlayerIndex ? (
          <div className="grid gap-2 sm:grid-cols-2">
            <ServePositionPreview
              title="发球方站位"
              players={sidePlayers(selectedSide)}
              playerIndex={serverPlayerIndex}
              courtSide="right"
              role="server"
            />
            <ServePositionPreview
              title="接发方站位"
              players={sidePlayers(selectedReceivingSide)}
              playerIndex={receiverPlayerIndex}
              courtSide="right"
              role="receiver"
            />
          </div>
        ) : null}
        <p className="text-xs font-bold text-slate-500">
          如有选手未到齐，请先不要开始比赛，可返回裁判操作中进行弃权处理。
        </p>
      </div>
    </Modal>
  );
}

function ServePositionPreview({
  title,
  players,
  playerIndex,
  courtSide,
  role,
}: {
  title: string;
  players: SidePlayer[];
  playerIndex: PlayerIndex | null;
  courtSide: CourtSide;
  role: 'server' | 'receiver';
}) {
  const selected = players.find((player) => player.index === playerIndex) ?? null;
  const partner = selected ? players.find((player) => player.index !== selected.index) ?? null : null;
  const otherSide: CourtSide = courtSide === 'right' ? 'left' : 'right';
  const tone = role === 'server' ? 'text-emerald-700' : 'text-orange-700';
  return (
    <div className="rounded-xl border border-slate-100 bg-white px-3 py-2">
      <p className="text-[11px] font-black text-slate-500">{title}</p>
      <p className="mt-1 flex items-baseline gap-1 text-sm font-black">
        <span className={selected ? tone : 'text-slate-400'}>{selected?.name ?? '待选择'}</span>
        <span className="text-[11px] font-bold text-slate-400">{courtSideLabel(courtSide)}</span>
      </p>
      {partner ? (
        <p className="mt-0.5 flex items-baseline gap-1 text-xs font-bold text-slate-500">
          <span>{partner.name}</span>
          <span className="text-[11px] font-bold text-slate-400">{courtSideLabel(otherSide)}</span>
        </p>
      ) : null}
    </div>
  );
}

function PickPlayerButtons({
  candidates,
  selectedIndex,
  tone,
  onPick,
}: {
  candidates: SidePlayer[];
  selectedIndex: PlayerIndex | null;
  tone: 'emerald' | 'orange';
  onPick: (playerIndex: PlayerIndex) => void;
}) {
  const activeClass = tone === 'emerald'
    ? '!border-emerald-500 !bg-emerald-50 !text-emerald-700'
    : '!border-orange-500 !bg-orange-50 !text-orange-700';
  return (
    <div className="grid gap-2">
      {candidates.map((player) => (
        <Button
          key={player.id}
          className={`!h-11 !rounded-xl !font-black ${selectedIndex === player.index ? activeClass : ''}`}
          onClick={() => onPick(player.index === 2 ? 2 : 1)}
        >
          {player.name}
        </Button>
      ))}
    </div>
  );
}

/**
 * 「本局发球设置」。新一局由系统按规则先带出默认的发球员/接发球员，
 * 裁判核对或改选后写回（source 从 system 变为 referee）；发球方由上一局胜方决定，只展示不可改。
 */
function GameServeModal({
  open,
  score,
  matchId,
  busyAction,
  serverPlayerIndex,
  receiverPlayerIndex,
  onServerPlayerChange,
  onReceiverPlayerChange,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  score: ScoreState;
  matchId: string;
  busyAction: string;
  serverPlayerIndex: PlayerIndex | null;
  receiverPlayerIndex: PlayerIndex | null;
  onServerPlayerChange: (playerIndex: PlayerIndex) => void;
  onReceiverPlayerChange: (playerIndex: PlayerIndex) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const state = score.servingState;
  const servingSide = state?.servingSide === 1 || state?.servingSide === 2 ? state.servingSide : null;
  const receivingSide: 1 | 2 | null = servingSide === 1 ? 2 : servingSide === 2 ? 1 : null;
  const servingMatchSide = servingSide === 1 ? score.side1 : servingSide === 2 ? score.side2 : null;
  const receivingMatchSide = receivingSide === 1 ? score.side1 : receivingSide === 2 ? score.side2 : null;
  // 发球员必须站在「本方比分奇偶」对应的发球区：偶数右区、奇数左区；接发球员站同名区。
  const servingScore = servingSide === 1 || servingSide === 2 ? currentSideScore(score, servingSide) : 0;
  const serverCourtSide: CourtSide = servingScore % 2 === 0 ? 'right' : 'left';
  const gameNo = currentGameNo(score);
  const serverName = playerNameByIndex(servingMatchSide, serverPlayerIndex);
  const receiverName = playerNameByIndex(receivingMatchSide, receiverPlayerIndex);
  const isSystemDefault = state?.source === 'system';

  return (
    <Modal
      open={open}
      title={`第 ${gameNo} 局 · 发球设置`}
      okText="保存发球设置"
      cancelText="取消"
      okButtonProps={{
        loading: busyAction === `/matches/${matchId}/game-serve`,
        disabled: !servingSide || !serverPlayerIndex || !receiverPlayerIndex,
      }}
      onCancel={onCancel}
      onOk={onConfirm}
    >
      <div className="space-y-3">
        <Alert
          type={isSystemDefault ? 'warning' : 'info'}
          showIcon
          message={isSystemDefault ? '当前是本局系统默认值，请核对' : '修改本局发球员与接发球员'}
          description={`发球方由上一局胜方决定，不能更改。本局比分 ${currentSideScore(score, 1)} : ${currentSideScore(score, 2)}，`
            + `发球员站${courtSideLabel(serverCourtSide)}，接发球员站他自己那一侧的${courtSideLabel(serverCourtSide)}。`}
        />
        <div className="rounded-xl border border-slate-100 bg-slate-50/70 px-4 py-3">
          <span className="text-xs font-bold text-slate-500">发球方</span>
          <p className="mt-1 text-sm font-black text-[#0F172A]">
            {sideDisplayName(servingMatchSide)}
            <span className="ml-2 text-xs font-bold text-slate-400">上一局胜方</span>
          </p>
        </div>
        <div>
          <p className="mb-2 text-sm font-black text-slate-700">发球员</p>
          <PickPlayerButtons
            candidates={sidePlayers(servingMatchSide)}
            selectedIndex={serverPlayerIndex}
            tone="emerald"
            onPick={onServerPlayerChange}
          />
        </div>
        <div>
          <p className="mb-2 text-sm font-black text-slate-700">接发球员</p>
          <PickPlayerButtons
            candidates={sidePlayers(receivingMatchSide)}
            selectedIndex={receiverPlayerIndex}
            tone="orange"
            onPick={onReceiverPlayerChange}
          />
        </div>
        {servingSide ? (
          <div className="grid gap-2 sm:grid-cols-2">
            <ServePositionPreview
              title="发球方站位"
              players={sidePlayers(servingMatchSide)}
              playerIndex={serverPlayerIndex}
              courtSide={serverCourtSide}
              role="server"
            />
            <ServePositionPreview
              title="接发方站位"
              players={sidePlayers(receivingMatchSide)}
              playerIndex={receiverPlayerIndex}
              courtSide={serverCourtSide}
              role="receiver"
            />
          </div>
        ) : null}
        <p className="text-xs font-bold text-slate-500">
          {serverName && receiverName
            ? `保存后本局从「${serverName} 发球 → ${receiverName} 接发」继续计分。`
            : '请选择本局的发球员和接发球员。'}
        </p>
      </div>
    </Modal>
  );
}

function EventLogPanel({ events, score }: { events: MatchEventLog[]; score: ScoreState }) {
  const pointEvents = events.filter((event) => event.type === 'POINT');
  const timeoutEvents = events.filter((event) => event.type === 'TIMEOUT' || event.type === 'MEDICAL_TIMEOUT');
  const warningEvents = events.filter((event) => event.type === 'WARNING' || event.type === 'YELLOW_CARD' || event.type === 'FORFEIT');
  const side1Label = sideName(score.side1);
  const side2Label = sideName(score.side2);

  return (
    <section className="rounded-2xl border border-[#E5E7EB] bg-white p-4 shadow-[0_18px_45px_rgba(15,23,42,0.08)] sm:p-5">
      <h2 className="text-xl font-black text-[#0F172A]">操作记录</h2>
      <div className="mt-4 space-y-4">
        <LogGroup title="最近得分记录" events={pointEvents} emptyText="暂无得分记录" side1Label={side1Label} side2Label={side2Label} />
        <LogGroup title="暂停记录" events={timeoutEvents} emptyText="暂无暂停记录" side1Label={side1Label} side2Label={side2Label} />
        <LogGroup title="警告记录" events={warningEvents} emptyText="暂无警告记录" side1Label={side1Label} side2Label={side2Label} />
      </div>
    </section>
  );
}

function LogGroup({
  title,
  events,
  emptyText,
  side1Label,
  side2Label,
}: {
  title: string;
  events: MatchEventLog[];
  emptyText: string;
  side1Label?: string;
  side2Label?: string;
}) {
  return (
    <div>
      <p className="text-sm font-black text-[#0F172A]">{title}</p>
      <div className="mt-2 space-y-2">
        {events.length ? (
          events.slice(0, 4).map((event) => (
            <div key={event.id} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
              <p className="truncate text-xs font-bold text-slate-700">{eventDescription(event, side1Label, side2Label)}</p>
              <p className="mt-1 text-[11px] font-semibold text-slate-400">
                {new Date(event.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
          ))
        ) : (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-3 text-center text-xs font-bold text-slate-400">
            {emptyText}
          </div>
        )}
      </div>
    </div>
  );
}

function ForfeitChooserModal({
  open,
  score,
  onCancel,
  onChoose,
}: {
  open: boolean;
  score: ScoreState;
  onCancel: () => void;
  onChoose: (target: 1 | 2 | 'both') => void;
}) {
  return (
    <Modal open={open} title="弃权处理" footer={null} onCancel={onCancel}>
      <div className="space-y-3">
        <Alert
          type="warning"
          showIcon
          message="危险操作需二次确认"
          description="弃权处理会改变本场结果，后续确认框内会再次提示该操作不可逆。"
        />
        <div className="grid gap-3">
          <Button danger className="!h-11 !rounded-xl !font-black" onClick={() => onChoose(1)} disabled={!score.side1}>
            {sideName(score.side1)} 弃权
          </Button>
          <Button danger className="!h-11 !rounded-xl !font-black" onClick={() => onChoose(2)} disabled={!score.side2}>
            {sideName(score.side2)} 弃权
          </Button>
          <Button danger ghost className="!h-11 !rounded-xl !font-black" onClick={() => onChoose('both')}>
            双方均弃权
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function ForfeitConfirmModal({
  open,
  target,
  score,
  matchId,
  reason,
  busyAction,
  onReasonChange,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  target: 1 | 2 | 'both' | null;
  score: ScoreState;
  matchId: string;
  reason: string;
  busyAction: string;
  onReasonChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal
      open={open}
      title={target === 'both' ? '双方均弃权 · 本场作废' : '判定弃权'}
      okText={target === 'both' ? '确认作废本场' : '确认弃权'}
      okButtonProps={{
        danger: true,
        loading:
          busyAction === `/matches/${matchId}/forfeit` ||
          busyAction === `/matches/${matchId}/forfeit-both`,
      }}
      cancelText="取消"
      onCancel={onCancel}
      onOk={onConfirm}
    >
      {target !== null ? (
        <div className="space-y-3">
          {target === 'both' ? (
            <p className="text-sm font-semibold text-slate-700">
              确认将本场判定为<strong className="text-red-600">双方均弃权</strong>，本场作废，下一轮对应位置将显示
              <strong className="text-blue-700">轮空</strong>。
            </p>
          ) : (
            <p className="text-sm font-semibold text-slate-700">
              确认将{' '}
              <strong className="text-red-600">
                {sideName(target === 1 ? score.side1 : score.side2)}
              </strong>{' '}
              判定为弃权，胜方为{' '}
              <strong className="text-blue-700">
                {sideName(target === 1 ? score.side2 : score.side1)}
              </strong>
              。
            </p>
          )}
          <Input.TextArea
            rows={2}
            value={reason}
            onChange={(event) => onReasonChange(event.target.value)}
            placeholder="弃权原因（可选）"
            maxLength={120}
            showCount
          />
          <Alert
            type="warning"
            showIcon
            message="该操作不可逆"
            description={
              target === 'both'
                ? '确认后本场会立即作废，无人晋级。'
                : '确认后本场会立即结束并标记为已完成，胜方在对阵表中自动晋级。'
            }
          />
        </div>
      ) : null}
    </Modal>
  );
}

function RetireChooserModal({
  open,
  score,
  onCancel,
  onChoose,
}: {
  open: boolean;
  score: ScoreState;
  onCancel: () => void;
  onChoose: (target: 1 | 2) => void;
}) {
  return (
    <Modal open={open} title="伤退/退赛处理" footer={null} onCancel={onCancel}>
      <div className="space-y-3">
        <Alert
          type="warning"
          showIcon
          message="请选择退赛方"
          description="伤退/退赛会立即结束本场比赛，对方判胜。确认前请与双方选手核对。"
        />
        <div className="grid gap-3">
          <Button danger className="!h-11 !rounded-xl !font-black" onClick={() => onChoose(1)} disabled={!score.side1}>
            {sideName(score.side1)} 退赛
          </Button>
          <Button danger className="!h-11 !rounded-xl !font-black" onClick={() => onChoose(2)} disabled={!score.side2}>
            {sideName(score.side2)} 退赛
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function RetireConfirmModal({
  open,
  target,
  score,
  matchId,
  reason,
  busyAction,
  onReasonChange,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  target: 1 | 2 | null;
  score: ScoreState;
  matchId: string;
  reason: string;
  busyAction: string;
  onReasonChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal
      open={open}
      title="确认伤退/退赛"
      okText="确认退赛并判对方胜"
      okButtonProps={{
        danger: true,
        loading: busyAction === `/matches/${matchId}/retire`,
      }}
      cancelText="取消"
      onCancel={onCancel}
      onOk={onConfirm}
    >
      {target !== null ? (
        <div className="space-y-3">
          <p className="text-sm font-semibold text-slate-700">
            确认将{' '}
            <strong className="text-red-600">
              {sideName(target === 1 ? score.side1 : score.side2)}
            </strong>{' '}
            标记为伤退/退赛，胜方为{' '}
            <strong className="text-blue-700">
              {sideName(target === 1 ? score.side2 : score.side1)}
            </strong>
            。
          </p>
          <Input.TextArea
            rows={2}
            value={reason}
            onChange={(event) => onReasonChange(event.target.value)}
            placeholder="退赛原因，例如：伤退、抽筋无法继续、主动退赛"
            maxLength={120}
            showCount
          />
          <Alert
            type="warning"
            showIcon
            message="该操作不可逆"
            description="确认后本场会立即结束并标记为已完成，公开端会显示为退赛/伤退，对方在对阵表中自动晋级。"
          />
        </div>
      ) : null}
    </Modal>
  );
}
