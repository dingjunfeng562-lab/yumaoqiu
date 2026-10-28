'use client';
import { useCurrentAccess } from '@/lib/use-current-role';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Alert, Button, Input, Modal, Spin, message } from 'antd';
import {
  ArrowLeftOutlined,
  CloseCircleOutlined,
  ClockCircleOutlined,
  EnvironmentOutlined,
  ExclamationCircleOutlined,
  FieldTimeOutlined,
  MedicineBoxOutlined,
  PauseCircleOutlined,
  PlayCircleFilled,
  PlayCircleOutlined,
  ReloadOutlined,
  StopOutlined,
  SwapOutlined,
  TrophyOutlined,
  UndoOutlined,
  WarningOutlined,
  WifiOutlined,
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
    tournament: { id: string; name: string; edition: number };
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
  courtDisplayState?: CourtDisplayState | null;
  courtSwapRequired?: CourtSwapRequired | null;
  events: MatchEventLog[];
  updatedAt?: string | null;
};

const statusMeta: Record<ScoreState['status'], { label: string; color: string; tone: string }> = {
  PENDING: { label: '未开始', color: 'default', tone: 'bg-slate-100 text-slate-700' },
  LIVE: { label: '进行中', color: 'green', tone: 'bg-emerald-100 text-emerald-700' },
  COMPLETED: { label: '已结束', color: 'blue', tone: 'bg-blue-100 text-blue-700' },
  CANCELLED: { label: '已取消', color: 'red', tone: 'bg-red-100 text-red-700' },
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

function MatchClock({
  startedAt,
  finishedAt,
  status,
  matchPaused = false,
  actualDurationSeconds,
  compact = false,
}: {
  startedAt?: string | null;
  finishedAt?: string | null;
  status: ScoreState['status'];
  matchPaused?: boolean;
  actualDurationSeconds?: number | null;
  compact?: boolean;
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
  const label = finishedAt ? '比赛用时' : matchPaused ? '比赛暂停' : '正在计时';
  return (
    <p
      className={
        compact
          ? 'inline-flex items-center gap-2 text-sm font-black tracking-wider text-white sm:text-base'
          : 'mt-1 inline-flex items-center gap-1 text-xs font-black tracking-wider text-emerald-700 sm:text-sm'
      }
    >
      <FieldTimeOutlined />
      {label} {mm}:{ss}{finishedAt ? '（已结束）' : matchPaused ? '（已停止）' : ''}
    </p>
  );
}

function sideAffiliation(side?: { affiliation: string } | null) {
  return side?.affiliation || '级别待定';
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

function pauseAlertText(score?: ScoreState | null) {
  if (score?.pauseKind === 'technical') {
    return {
      message: '11 分技术暂停',
      description: '前台已同步显示技术暂停，比赛计时已停止。暂停结束后点击“恢复比赛”继续计分。',
    };
  }
  if (score?.pauseKind === 'interval') {
    return {
      message: '局间休息 120 秒',
      description: '上一局已结束，系统已自动进入 120 秒局间休息并停止比赛计时。休息结束后点击“恢复比赛”开始下一局。',
    };
  }
  return {
    message: score?.pauseReason ? `比赛暂停：${score.pauseReason}` : '比赛暂停中',
    description: '前台已同步显示比赛暂停，计时已停止。点击裁判操作中的恢复比赛后继续计分。',
  };
}

export default function RefereeScoringPage() {
  const params = useParams<{ matchId: string }>();
  const matchId = params.matchId;
  const { data: session, status: sessionStatus } = useSession();
  const access = useCurrentAccess();
  const canReferee = access.ready && access.can('REFEREE');
  const token = session?.user?.accessToken;
  const [score, setScore] = useState<ScoreState | null>(null);
  const [accessRevoked, setAccessRevoked] = useState(false);
  const newestScoreAt = useRef(0);
  const [loading, setLoading] = useState(false);
  const [busyAction, setBusyAction] = useState('');
  const [socketStatus, setSocketStatus] = useState<'连接中' | '已连接' | '已断开'>('连接中');
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

  const applyScore = useCallback((nextScore: ScoreState) => {
    const at = Date.parse(nextScore.updatedAt ?? '') || 0;
    if (at < newestScoreAt.current) return;
    newestScoreAt.current = at;
    setScore(nextScore);
  }, []);
  const noLongerAssigned = access.ready && !!score && !access.can('SCORING') && score.referee?.id !== session?.user?.id;

  const currentGame = score ? currentGameOf(score) : null;
  const disabled = !score || score.status === 'COMPLETED' || score.status === 'CANCELLED' || busyAction !== '';

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
      message.error(error instanceof Error ? error.message : '加载比分失败');
    } finally {
      setLoading(false);
    }
  }

  async function postAction(path: string, body?: Record<string, unknown>) {
    if (!token || !matchId) return;
    setBusyAction(path);
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
      message.error(error instanceof Error ? error.message : '操作失败');
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
  // 方案 B：不拦记分，取消后照常开打，之后随时可以从裁判操作里再打开。
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

  if (accessRevoked || noLongerAssigned) {
    const back = score?.venue && score.event.tournament
      ? `/referee/tournaments/${encodeURIComponent(score.event.tournament.id)}/courts/${encodeURIComponent(score.venue.id)}`
      : '/referee/my-matches';
    return <main className="grid min-h-screen place-items-center bg-slate-50 p-6">
      <Alert type="info" showIcon title="本场执裁已解除，请重新接手"
        description="比赛成绩已清除或裁判安排已调整。请返回场次列表，重新接手后再开始记分。"
        action={<Button type="primary" href={back}>返回场次列表</Button>} />
    </main>;
  }

  if (sessionStatus === 'loading' || loading || !score) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#07152F] text-white">
        <Spin />
      </div>
    );
  }

  if (!token || !canReferee) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#07152F] px-5 text-white">
        <div className="max-w-md rounded-2xl border border-white/10 bg-white/10 p-6 text-center shadow-2xl backdrop-blur">
          <h1 className="text-2xl font-black">裁判记分</h1>
          <p className="mt-3 text-sm text-blue-100">请使用裁判账号登录后操作比分。</p>
          <Link
            href={`/login?redirect=${encodeURIComponent(`/referee/matches/${matchId}`)}`}
            className="mt-6 inline-flex h-11 items-center rounded-xl bg-blue-500 px-6 font-black transition hover:bg-blue-400 active:scale-[0.98]"
          >
            去登录
          </Link>
        </div>
      </main>
    );
  }

  const side1Score = currentSideScore(score, 1);
  const side2Score = currentSideScore(score, 2);
  const leftSideNo: 1 | 2 = score.courtDisplayState?.side1CourtSide === 'right' ? 2 : 1;
  const rightSideNo: 1 | 2 = leftSideNo === 1 ? 2 : 1;
  const displaySide = (side: 1 | 2) => ({
    side,
    accent: side === 1 ? 'blue' as const : 'red' as const,
    matchSide: side === 1 ? score.side1 : score.side2,
    name: side === 1 ? sideName(score.side1) : sideName(score.side2),
    affiliation: side === 1 ? sideAffiliation(score.side1) : sideAffiliation(score.side2),
    score: side === 1 ? side1Score : side2Score,
    gamesWon: side === 1 ? score.side1Games : score.side2Games,
    server: currentGame?.server === side,
    winner: score.winnerSide === side,
  });
  const leftDisplaySide = displaySide(leftSideNo);
  const rightDisplaySide = displaySide(rightSideNo);
  const hasPointEvent = score.events.some((event) => event.type === 'POINT');
  const recentEvents = score.events.slice(0, 10);
  const doublesMatch = isDoublesSide(score.side1) || isDoublesSide(score.side2);
  const servingSideNo = score.servingState?.servingSide === 1 || score.servingState?.servingSide === 2
    ? score.servingState.servingSide
    : null;
  const receivingSideNo = servingSideNo === 1 ? 2 : servingSideNo === 2 ? 1 : null;
  const serveNeedsCheck = doublesMatch
    && score.status === 'LIVE'
    && score.servingState?.source === 'system';
  const serveCheckText = serveNeedsCheck
    ? `第 ${currentGameNo(score)} 局发球信息是系统按规则自动带出的默认值：`
      + `${playerNameByIndex(servingSideNo === 1 ? score.side1 : score.side2, score.servingState?.serverPlayerIndex)} 发球，`
      + `${playerNameByIndex(receivingSideNo === 1 ? score.side1 : score.side2, score.servingState?.receiverPlayerIndex)} 接发。`
    : '';
  const scoringLocked = score.status !== 'LIVE' || Boolean(score.matchPaused) || Boolean(score.courtSwapRequired?.required) || Boolean(score.pendingFinish) || busyAction !== '';
  const scoreLockedReason =
    score.status === 'PENDING'
      ? '请先点击开始比赛'
      : score.status === 'COMPLETED' || score.status === 'CANCELLED'
        ? '比赛已结束，计分已锁定'
        : score.pendingFinish
          ? '比分已决出胜方,请在弹窗中确认结束比赛'
          : score.matchPaused
            ? '比赛暂停中，请恢复后继续计分'
            : score.courtSwapRequired?.required
              ? '请先交换场地，再继续计分'
              : '';

  return (
    <main className={`referee-scoring-page min-h-screen overflow-x-hidden bg-[linear-gradient(180deg,#F5F8FC_0%,#EEF5FF_54%,#FFFFFF_100%)] text-slate-950 ${
      score.status === 'LIVE' ? 'referee-live-compact' : ''
    }`}>
      <MatchTimerStrip score={score} />
      <div className="referee-score-layout w-full px-3 py-3 sm:px-5 sm:py-4 xl:px-8 2xl:px-10">
        <div className="referee-score-shell mx-auto flex w-full max-w-[1920px] flex-col gap-4 sm:gap-5">
          <TopMatchBar
            score={score}
            socketStatus={socketStatus}
            onRefresh={loadScore}
            refreshLoading={loading}
          />

          {score.status === 'COMPLETED' && score.forfeitedSide ? (
            <Alert
              type="warning"
              showIcon
              className="rounded-2xl border-amber-200 bg-amber-50/80"
              message={`选手 ${score.forfeitedSide} ${retireReasonText !== null ? '退赛' : '弃权'}，胜方：${winnerName}`}
              description={retireReasonText ?? score.forfeitReason ?? '选手未到场弃权'}
            />
          ) : score.status === 'COMPLETED' ? (
            <Alert
              type="success"
              showIcon
              className="rounded-2xl border-emerald-200 bg-emerald-50/80"
              message={`本场已结束，胜方：${winnerName}`}
            />
          ) : null}

          {score.matchPaused ? (
            <Alert
              type="warning"
              showIcon
              className="rounded-2xl border-amber-200 bg-amber-50/90"
              message={pauseAlert.message}
              description={pauseAlert.description}
            />
          ) : null}

          {score.courtSwapRequired?.required ? (
            <Alert
              type="warning"
              showIcon
              className="rounded-2xl border-orange-200 bg-orange-50/90"
              message="需要交换场地"
              description="决胜局 11 分换边已触发。请先点击右侧裁判操作中的“交换场地”，完成后系统会进入 60 秒技术暂停。"
            />
          ) : null}

          {serveNeedsCheck ? (
            <Alert
              type="warning"
              showIcon
              className="referee-serve-check rounded-2xl border-amber-200 bg-amber-50/90"
              message="本局发球 / 接发为系统默认，请核对"
              description={serveCheckText}
              action={
                <Button type="primary" size="small" onClick={openGameServe}>
                  核对发球设置
                </Button>
              }
            />
          ) : null}

          {score.pendingFinish ? (
            <Alert
              type="success"
              showIcon
              className="rounded-2xl border-emerald-200 bg-emerald-50/90"
              message={`比分已决出胜方:${winnerName || `选手 ${score.winnerSide ?? ''}`}`}
              description="请在弹窗中确认结束比赛;如需撤回最后一分,可使用「撤销上一分」。"
              action={
                <Button
                  type="primary"
                  size="small"
                  onClick={() => setFinishConfirmOpen(true)}
                  loading={busyAction === `/matches/${matchId}/finish`}
                >
                  确认结束比赛
                </Button>
              }
            />
          ) : null}

          <div className="referee-main-grid grid min-w-0 grid-cols-1 gap-4 sm:gap-5 xl:grid-cols-[minmax(0,1fr)_360px] 2xl:grid-cols-[minmax(0,1fr)_400px]">
            <div className="min-w-0 space-y-4 sm:space-y-5">
              <section className="referee-scoreboard-row grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.72fr)_minmax(0,1fr)]">
                <div className="referee-left-card order-2 min-w-0 sm:order-2 lg:order-1">
                  <SideScoreCard
                    side={leftDisplaySide.side}
                    accent={leftDisplaySide.accent}
                    matchSide={leftDisplaySide.matchSide}
                    name={leftDisplaySide.name}
                    affiliation={leftDisplaySide.affiliation}
                    score={leftDisplaySide.score}
                    gamesWon={leftDisplaySide.gamesWon}
                    server={leftDisplaySide.server}
                    servingState={score.servingState}
                    winner={leftDisplaySide.winner}
                    disabled={scoringLocked}
                    lockedReason={scoreLockedReason}
                    loading={busyAction === `/matches/${matchId}/point-${leftDisplaySide.side}`}
                    onPoint={() => postAction(`/matches/${matchId}/point`, { side: leftDisplaySide.side })}
                    onUndo={() => postAction(`/matches/${matchId}/undo`)}
                    undoDisabled={scoringLocked || !hasPointEvent}
                    undoLoading={busyAction === `/matches/${matchId}/undo`}
                  />
                </div>

                <div className="referee-center-card-slot order-1 min-w-0 sm:col-span-2 lg:order-2 lg:col-span-1">
                  <CenterScoreboard
                    score={score}
                    leftScore={leftDisplaySide.score}
                    rightScore={rightDisplaySide.score}
                    onStart={openStartConfirm}
                    startDisabled={score.status !== 'PENDING' || Boolean(busyAction)}
                  />
                </div>

                <div className="referee-right-card order-3 min-w-0 lg:order-3">
                  <SideScoreCard
                    side={rightDisplaySide.side}
                    accent={rightDisplaySide.accent}
                    matchSide={rightDisplaySide.matchSide}
                    name={rightDisplaySide.name}
                    affiliation={rightDisplaySide.affiliation}
                    score={rightDisplaySide.score}
                    gamesWon={rightDisplaySide.gamesWon}
                    server={rightDisplaySide.server}
                    servingState={score.servingState}
                    winner={rightDisplaySide.winner}
                    disabled={scoringLocked}
                    lockedReason={scoreLockedReason}
                    loading={busyAction === `/matches/${matchId}/point-${rightDisplaySide.side}`}
                    onPoint={() => postAction(`/matches/${matchId}/point`, { side: rightDisplaySide.side })}
                    onUndo={() => postAction(`/matches/${matchId}/undo`)}
                    undoDisabled={scoringLocked || !hasPointEvent}
                    undoLoading={busyAction === `/matches/${matchId}/undo`}
                  />
                </div>
              </section>

              <section className="grid min-w-0 grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(360px,0.9fr)]">
                <GameRecordCard score={score} />
                <RefereeActionCard
                  matchId={matchId}
                  busyAction={busyAction}
                  disabled={disabled}
                  matchStatus={score.status}
                  matchPaused={Boolean(score.matchPaused)}
                  courtSwapRequired={Boolean(score.courtSwapRequired?.required)}
                  canSetGameServe={doublesMatch}
                  serveCheckPending={serveNeedsCheck}
                  onPauseToggle={() => postAction(score.matchPaused ? `/matches/${matchId}/resume` : `/matches/${matchId}/pause`)}
                  onSwapCourt={() => postAction(`/matches/${matchId}/swap-court`)}
                  onOpenGameServe={openGameServe}
                  onOpenSideAction={setPendingRefereeAction}
                  onOpenForfeit={() => setForfeitChooserOpen(true)}
                  onOpenRetire={() => setRetireChooserOpen(true)}
                  onOpenFinish={() => setFinishConfirmOpen(true)}
                />
              </section>
            </div>

            <aside className="min-w-0 space-y-5">
              <MatchInfoPanel
                score={score}
                side1Score={side1Score}
                side2Score={side2Score}
              />
              <EventLogPanel events={recentEvents} score={score} />
            </aside>
          </div>
        </div>
      </div>

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
            message.warning('请先选择首发方、首位发球员和接发球员');
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
            message.warning('请先选择本局的发球员和接发球员');
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
        okButtonProps={{ danger: true, loading: busyAction === `/matches/${matchId}/finish` }}
        onCancel={() => setFinishConfirmOpen(false)}
        onOk={async () => {
          await postAction(`/matches/${matchId}/finish`);
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
            message="如需修改本场最后一分,请点击「再看看」后使用「撤销上一分」回退,再继续比赛。"
          />
        </div>
      </Modal>
    </main>
  );
}

function MatchTimerStrip({ score }: { score: ScoreState }) {
  if (!score.startedAt) return null;

  const isFinished = score.status === 'COMPLETED' || score.status === 'CANCELLED' || Boolean(score.finishedAt);
  const isPaused = score.status === 'LIVE' && Boolean(score.matchPaused);

  return (
    <div className={`sticky top-0 z-30 w-full px-3 py-2 shadow-lg sm:px-5 ${
      isFinished ? 'bg-slate-900' : isPaused ? 'bg-amber-600' : 'bg-emerald-600'
    }`}>
      <div className="mx-auto flex max-w-[1920px] items-center justify-between gap-3">
        <MatchClock
          startedAt={score.startedAt}
          finishedAt={score.finishedAt}
          status={score.status}
          matchPaused={score.matchPaused}
          actualDurationSeconds={score.actualDurationSeconds}
          compact
        />
        <span className="shrink-0 rounded-full bg-white/15 px-3 py-1 text-xs font-black text-white">
          {isFinished ? '计分锁定' : isPaused ? '比赛暂停' : '比赛进行中'}
        </span>
      </div>
    </div>
  );
}

function TopMatchBar({
  score,
  socketStatus,
  onRefresh,
  refreshLoading,
}: {
  score: ScoreState;
  socketStatus: '连接中' | '已连接' | '已断开';
  onRefresh: () => void;
  refreshLoading: boolean;
}) {
  const matchStatus = statusMeta[score.status] ?? statusMeta.PENDING;
  const socketTone =
    socketStatus === '已连接'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
      : socketStatus === '连接中'
        ? 'border-blue-200 bg-blue-50 text-blue-700'
        : 'border-red-200 bg-red-50 text-red-700';

  return (
    <header className="referee-top-match-bar overflow-hidden rounded-2xl border border-[#E5E7EB] bg-white shadow-[0_18px_45px_rgba(15,23,42,0.08)]">
      <div className="referee-top-match-inner flex min-w-0 flex-col gap-4 border-b border-slate-100 px-3 py-3 sm:px-5 sm:py-4 lg:flex-row lg:items-center lg:justify-between xl:px-6">
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
          <Link
            href={score.event.tournament?.id && score.venue?.id
              ? `/referee/tournaments/${encodeURIComponent(score.event.tournament.id)}/courts/${encodeURIComponent(score.venue.id)}`
              : '/referee/my-matches'}
            className="inline-flex h-10 w-fit shrink-0 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-black text-[#0F172A] shadow-sm transition hover:border-blue-200 hover:bg-blue-50 hover:text-[#2563EB] active:scale-[0.98]"
          >
            <ArrowLeftOutlined />
            返回场次
          </Link>
          <div className="hidden h-10 w-px bg-slate-200 lg:block" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-black uppercase tracking-[0.18em] text-[#2563EB]">
                LIVE SCORING
              </span>
              <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-black ${
                score.matchPaused ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-600'
              }`}>
                <span className={`h-2 w-2 rounded-full ${
                  score.matchPaused ? 'bg-amber-500 shadow-[0_0_0_4px_rgba(245,158,11,0.14)]' : 'bg-red-500 shadow-[0_0_0_4px_rgba(239,68,68,0.14)]'
                }`} />
                {score.matchPaused ? '比赛暂停中' : '实时计分中'}
              </span>
            </div>
            <h1 className="mt-2 text-2xl font-black tracking-tight text-[#0F172A] sm:truncate sm:text-3xl xl:text-4xl">
              {score.event.typeLabel} 第 {score.matchNo} 场
            </h1>
            <p className="mt-1 text-sm font-semibold text-[#64748B] sm:truncate xl:text-base">
              {score.event.tournament.name} · {score.round}
            </p>
            <p className="mt-1 text-xs font-bold text-[#2563EB] sm:text-sm">
              计分规则：{formatScoringRule(score.event).label}
            </p>
            <MatchClock
              startedAt={score.startedAt}
              finishedAt={score.finishedAt}
              status={score.status}
              matchPaused={score.matchPaused}
              actualDurationSeconds={score.actualDurationSeconds}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center sm:justify-start lg:justify-end">
          <span className={`inline-flex h-10 min-w-0 overflow-hidden items-center gap-2 rounded-xl border px-3 text-xs font-black sm:text-sm ${socketTone}`}>
            <WifiOutlined />
            实时同步：{socketStatus}
          </span>
          <Button
            icon={<ReloadOutlined />}
            loading={refreshLoading}
            onClick={onRefresh}
            className="h-10 rounded-xl border-slate-200 font-black text-slate-700 hover:border-blue-200 hover:text-blue-600"
          >
            刷新
          </Button>
          <span className="inline-flex h-10 min-w-0 overflow-hidden items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-black text-slate-700 sm:text-sm">
            <ClockCircleOutlined />
            {formatDateTime(score.scheduledAt)}
          </span>
          <span className="inline-flex h-10 min-w-0 overflow-hidden items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-black text-slate-700 sm:text-sm">
            <EnvironmentOutlined />
            {score.venue?.name ?? '未排场地'}
          </span>
          <span className={`inline-flex h-10 items-center justify-center rounded-xl px-4 text-xs font-black sm:text-sm ${
            score.matchPaused && score.status === 'LIVE' ? 'bg-amber-100 text-amber-700' : matchStatus.tone
          }`}>
            {score.matchPaused && score.status === 'LIVE' ? '比赛暂停' : matchStatus.label}
          </span>
        </div>
      </div>
    </header>
  );
}

function SideScoreCard({
  side,
  accent,
  matchSide,
  name,
  affiliation,
  score,
  gamesWon,
  server,
  servingState,
  winner,
  disabled,
  lockedReason,
  loading,
  onPoint,
  onUndo,
  undoDisabled,
  undoLoading,
}: {
  side: 1 | 2;
  accent: 'blue' | 'red';
  matchSide?: MatchSide | null;
  name: string;
  affiliation: string;
  score: number;
  gamesWon: number;
  server: boolean;
  servingState?: ServingState | null;
  winner: boolean;
  disabled: boolean;
  lockedReason?: string;
  loading: boolean;
  onPoint: () => void;
  onUndo: () => void;
  undoDisabled: boolean;
  undoLoading: boolean;
}) {
  const isBlue = accent === 'blue';
  const topBar = isBlue ? 'bg-[#2563EB]' : 'bg-[#EF4444]';
  const scoreTone = isBlue ? 'text-[#2563EB]' : 'text-[#EF4444]';
  const buttonTone = isBlue
    ? 'bg-[#2563EB] hover:!bg-blue-500 active:!bg-blue-700'
    : 'bg-[#EF4444] hover:!bg-red-500 active:!bg-red-700';
  const ringTone = isBlue ? 'ring-blue-100' : 'ring-red-100';
  const players = sidePlayers(matchSide);
  const doubles = isDoublesSide(matchSide);
  const displayName = doubles ? sideDisplayName(matchSide) : name;
  const activeServerPlayer = server ? servingState?.serverPlayerIndex : null;
  const activeReceiverPlayer = servingState?.receivingSide === side ? servingState.receiverPlayerIndex : null;

  return (
    <article className={`referee-side-score-card min-w-0 overflow-hidden rounded-2xl border border-[#E5E7EB] bg-white shadow-[0_18px_45px_rgba(15,23,42,0.08)] ring-1 ${ringTone}`}>
      <div className={`referee-side-topbar flex h-12 items-center justify-between px-5 text-white ${topBar}`}>
        <span className="min-w-0 truncate text-sm font-black sm:hidden">{displayName}</span>
        <span className="hidden text-sm font-black uppercase tracking-[0.18em] sm:inline">SIDE {side}</span>
        <div className="flex items-center gap-2">
          {server ? <span className="rounded-full bg-white/20 px-2.5 py-1 text-xs font-black">发球</span> : null}
          {winner ? <TrophyOutlined className="text-yellow-200" /> : null}
        </div>
      </div>

      <div className="referee-side-score-body flex min-h-[300px] flex-col p-4 sm:min-h-[340px] sm:p-5 xl:min-h-[430px]">
        <div className="min-w-0">
          <h2 className="hidden truncate text-xl font-black text-[#0F172A] sm:block sm:text-2xl xl:text-3xl">
            {displayName}
          </h2>
          {doubles ? (
            <div className="mt-1 grid grid-cols-2 gap-1.5 sm:mt-2">
              {(['right', 'left'] as const).map((courtSide) => {
                const positions = side === 1 ? servingState?.side1Positions : servingState?.side2Positions;
                const playerIndex = positions?.[courtSide] ?? null;
                const player = playerIndex ? players.find((item) => item.index === playerIndex) : null;
                const isServer = Boolean(playerIndex) && activeServerPlayer === playerIndex;
                const isReceiver = Boolean(playerIndex) && activeReceiverPlayer === playerIndex;
                return (
                  <div
                    key={courtSide}
                    className={`rounded-lg px-2 py-1.5 ${
                      isServer
                        ? 'bg-emerald-50 ring-1 ring-emerald-200'
                        : isReceiver
                          ? 'bg-orange-50 ring-1 ring-orange-200'
                          : 'bg-slate-50'
                    }`}
                  >
                    <p className={`text-[10px] font-black leading-tight ${
                      isServer ? 'text-emerald-600' : isReceiver ? 'text-orange-600' : 'text-slate-400'
                    }`}>
                      {courtSideLabel(courtSide)}
                      {isServer ? ' · 发球' : isReceiver ? ' · 接发' : ''}
                    </p>
                    <p className={`truncate text-sm font-black leading-tight ${
                      isServer ? 'text-emerald-700' : isReceiver ? 'text-orange-700' : 'text-slate-600'
                    }`}>
                      {player?.name ?? '待定'}
                    </p>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="mt-2 truncate text-sm font-bold text-[#64748B]">
              {server && servingState?.serverCourtSide
                ? `发球站位：${courtSideLabel(servingState.serverCourtSide)}`
                : `级别：${affiliation}`}
            </p>
          )}
        </div>

        <div className="referee-side-score-zone my-4 flex flex-1 flex-col items-center justify-center rounded-2xl bg-slate-50/80 px-3 py-4 sm:my-7 sm:px-4 sm:py-6">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">本局比分</p>
          <strong className={`referee-side-score-value mt-2 block text-[5.5rem] font-black leading-none tracking-tight sm:text-[7.5rem] xl:text-[9rem] ${scoreTone}`}>
            {score}
          </strong>
          <p className={`mt-2 text-base font-black ${scoreTone}`}>已胜局数 {gamesWon}</p>
        </div>

        <div className="space-y-3">
          <Button
            type="primary"
            block
            disabled={disabled}
            loading={loading}
            onClick={onPoint}
            className={`referee-score-button !h-12 !rounded-2xl !border-0 text-lg !font-black text-white shadow-[0_14px_28px_rgba(37,99,235,0.24)] transition active:scale-[0.99] disabled:!bg-slate-200 disabled:!text-slate-400 sm:!h-14 sm:text-xl ${buttonTone}`}
          >
            +1 得分
          </Button>
          {lockedReason ? <p className="text-center text-xs font-bold text-slate-400">{lockedReason}</p> : null}
          <Button
            block
            icon={<UndoOutlined />}
            disabled={undoDisabled}
            loading={undoLoading}
            onClick={onUndo}
            className="referee-undo-button !h-12 !rounded-2xl border-slate-200 !font-black text-slate-600 transition hover:!border-slate-300 hover:!bg-slate-50 active:scale-[0.99] disabled:!bg-slate-50 disabled:!text-slate-300"
          >
            撤销上一分
          </Button>
        </div>
      </div>
    </article>
  );
}

function CenterScoreboard({
  score,
  leftScore,
  rightScore,
  onStart,
  startDisabled,
}: {
  score: ScoreState;
  leftScore: number;
  rightScore: number;
  onStart: () => void;
  startDisabled: boolean;
}) {
  const status = statusMeta[score.status] ?? statusMeta.PENDING;
  const statusLabel = score.matchPaused && score.status === 'LIVE' ? '比赛暂停' : status.label;

  return (
    <article className="referee-center-score-card min-w-0 overflow-hidden rounded-2xl border border-[#0F172A]/10 bg-[#07152F] text-white shadow-[0_24px_60px_rgba(15,23,42,0.22)]">
      <div className="referee-center-score-body flex h-full min-h-[300px] flex-col p-4 sm:min-h-[360px] sm:p-5 lg:min-h-[430px]">
        <div className="referee-center-score-panel rounded-2xl border border-white/10 bg-white/5 p-3 text-center sm:p-4">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-blue-200">比赛总览</p>
          <div className="mt-4 flex items-center justify-center gap-3 sm:mt-7 sm:gap-5">
            <span className="referee-center-score-value text-[4.2rem] font-black leading-none text-[#60A5FA] sm:text-[5.5rem] xl:text-[6.5rem]">{leftScore}</span>
            <span className="pb-2 text-4xl font-black text-white sm:pb-3 sm:text-5xl">:</span>
            <span className="referee-center-score-value text-[4.2rem] font-black leading-none text-[#F87171] sm:text-[5.5rem] xl:text-[6.5rem]">{rightScore}</span>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:mt-6 sm:gap-3">
            <div className="rounded-xl bg-white/8 px-3 py-3">
              <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">当前局</p>
              <p className="mt-1 text-xl font-black text-white sm:text-2xl">第 {currentGameNo(score)} 局</p>
            </div>
            <div className="rounded-xl bg-white/8 px-3 py-3">
              <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">比赛状态</p>
              <p className="mt-1 text-xl font-black text-white sm:text-2xl">{statusLabel}</p>
            </div>
          </div>
        </div>

        <div className="referee-center-actions mt-auto pt-5">
          <Button
            type="primary"
            block
            icon={<PlayCircleFilled />}
            disabled={startDisabled}
            onClick={onStart}
            className="referee-start-button !h-12 !rounded-2xl !border-0 !bg-[#22C55E] text-base !font-black text-white shadow-[0_16px_30px_rgba(34,197,94,0.24)] transition hover:!bg-emerald-400 active:scale-[0.99] disabled:!bg-slate-600 disabled:!text-slate-300 sm:!h-14 sm:text-lg"
          >
            开始比赛
          </Button>
          <p className="mt-4 text-center text-sm font-semibold text-slate-300">
            {score.status === 'PENDING'
              ? '比赛未开始，点击开始比赛计分'
              : score.matchPaused
                ? '比赛暂停中，前台计时已同步停止'
                : score.status === 'LIVE'
                ? '比赛进行中，比分将实时同步'
                : '比赛已结束，计分已锁定'}
          </p>
        </div>
      </div>
    </article>
  );
}

function GameRecordCard({ score }: { score: ScoreState }) {
  const paused = score.matchPaused && score.status === 'LIVE';

  return (
    <section className="referee-sub-card min-w-0 rounded-2xl border border-[#E5E7EB] bg-white p-4 shadow-[0_18px_45px_rgba(15,23,42,0.08)] sm:p-5">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-blue-50 text-[#2563EB]">
          <FieldTimeOutlined />
        </span>
        <div>
          <h2 className="text-xl font-black text-[#0F172A]">局分记录</h2>
          <p className="text-sm font-semibold text-[#64748B]">每局比分与胜局状态</p>
        </div>
      </div>

      <div className="referee-record-list mt-5 space-y-3">
        {recordItems(score).map((game) => {
          const statusText = game.winnerSide ? `胜方 SIDE ${game.winnerSide}` : game.active ? (paused ? '暂停中' : '进行中') : '未开始';
          return (
            <div
              key={game.gameNo}
              className={`grid grid-cols-[72px_minmax(0,1fr)_76px] items-center gap-2 rounded-2xl border px-3 py-3 sm:grid-cols-[100px_minmax(0,1fr)_96px] sm:gap-3 sm:px-4 ${
                game.active
                  ? 'border-blue-200 bg-blue-50/80'
                  : 'border-slate-100 bg-slate-50/70'
              }`}
            >
              <span className={`font-black ${game.active ? 'text-[#2563EB]' : 'text-slate-600'}`}>
                第{game.gameNo}局
              </span>
              <strong className="text-center text-xl font-black text-[#0F172A] sm:text-2xl">
                {game.side1Score} <span className="text-slate-300">:</span> {game.side2Score}
              </strong>
              <span className={`text-right text-[11px] font-black sm:text-xs ${game.active ? 'text-[#2563EB]' : 'text-slate-400'}`}>
                {statusText}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function RefereeActionCard({
  matchId,
  busyAction,
  disabled,
  matchStatus,
  matchPaused,
  courtSwapRequired,
  canSetGameServe,
  serveCheckPending,
  onPauseToggle,
  onSwapCourt,
  onOpenGameServe,
  onOpenSideAction,
  onOpenForfeit,
  onOpenRetire,
  onOpenFinish,
}: {
  matchId: string;
  busyAction: string;
  disabled: boolean;
  matchStatus: ScoreState['status'];
  matchPaused: boolean;
  courtSwapRequired: boolean;
  canSetGameServe: boolean;
  serveCheckPending: boolean;
  onPauseToggle: () => void;
  onSwapCourt: () => void;
  onOpenGameServe: () => void;
  onOpenSideAction: (action: Exclude<PendingRefereeAction, null>) => void;
  onOpenForfeit: () => void;
  onOpenRetire: () => void;
  onOpenFinish: () => void;
}) {
  const matchEnded = matchStatus === 'COMPLETED' || matchStatus === 'CANCELLED';
  const pauseActionPath = `/matches/${matchId}/${matchPaused ? 'resume' : 'pause'}`;
  const serveAction = {
    label: '发球设置',
    icon: <SwapOutlined />,
    className: serveCheckPending
      ? 'border-amber-300 text-amber-700 hover:!border-amber-500 hover:!bg-amber-50'
      : 'border-slate-200 text-slate-700 hover:!border-slate-400 hover:!bg-slate-50',
    onClick: onOpenGameServe,
    loading: false,
    pauseToggle: true,
  };
  const actions = [
    {
      label: matchPaused ? '恢复比赛' : '比赛暂停',
      icon: matchPaused ? <PlayCircleOutlined /> : <PauseCircleOutlined />,
      className: matchPaused
        ? 'border-emerald-200 text-emerald-700 hover:!border-emerald-400 hover:!bg-emerald-50'
        : 'border-amber-200 text-amber-700 hover:!border-amber-400 hover:!bg-amber-50',
      onClick: onPauseToggle,
      loading: busyAction === pauseActionPath,
      pauseToggle: true,
    },
    {
      label: '交换场地',
      icon: <ReloadOutlined />,
      className: courtSwapRequired
        ? 'border-orange-300 text-orange-700 hover:!border-orange-500 hover:!bg-orange-50'
        : 'border-slate-200 text-slate-700 hover:!border-slate-400 hover:!bg-slate-50',
      onClick: onSwapCourt,
      loading: busyAction === `/matches/${matchId}/swap-court`,
      pauseToggle: true,
    },
    {
      label: '普通暂停',
      icon: <PauseCircleOutlined />,
      className: 'border-blue-200 text-blue-700 hover:!border-blue-400 hover:!bg-blue-50',
      onClick: () => onOpenSideAction({ type: 'TIMEOUT', label: '普通暂停' }),
      loading: busyAction === `/matches/${matchId}/events`,
      pauseToggle: false,
    },
    {
      label: '医疗暂停',
      icon: <MedicineBoxOutlined />,
      className: 'border-emerald-200 text-emerald-700 hover:!border-emerald-400 hover:!bg-emerald-50',
      onClick: () => onOpenSideAction({ type: 'MEDICAL_TIMEOUT', label: '医疗暂停' }),
      loading: busyAction === `/matches/${matchId}/events`,
      pauseToggle: false,
    },
    {
      label: '警告',
      icon: <WarningOutlined />,
      className: 'border-orange-200 text-orange-700 hover:!border-orange-400 hover:!bg-orange-50',
      onClick: () => onOpenSideAction({ type: 'WARNING', label: '警告' }),
      loading: busyAction === `/matches/${matchId}/events`,
      pauseToggle: false,
    },
    {
      label: '黄牌',
      icon: <ExclamationCircleOutlined />,
      className: 'border-yellow-200 text-yellow-700 hover:!border-yellow-400 hover:!bg-yellow-50',
      onClick: () => onOpenSideAction({ action: 'card', cardType: 'yellow', label: '黄牌' }),
      loading: busyAction === `/matches/${matchId}/card`,
      pauseToggle: false,
    },
    {
      label: '红牌',
      icon: <ExclamationCircleOutlined />,
      className: 'border-red-200 text-red-700 hover:!border-red-400 hover:!bg-red-50',
      onClick: () => onOpenSideAction({ action: 'card', cardType: 'red', label: '红牌' }),
      loading: busyAction === `/matches/${matchId}/card`,
      pauseToggle: false,
    },
    {
      label: '黑牌',
      icon: <CloseCircleOutlined />,
      className: 'border-slate-300 text-slate-800 hover:!border-slate-500 hover:!bg-slate-50',
      onClick: () => onOpenSideAction({ action: 'card', cardType: 'black', label: '黑牌取消资格' }),
      loading: busyAction === `/matches/${matchId}/card`,
      pauseToggle: false,
    },
    {
      label: '发球违例',
      icon: <WarningOutlined />,
      className: 'border-violet-200 text-violet-700 hover:!border-violet-400 hover:!bg-violet-50',
      onClick: () => onOpenSideAction({ action: 'fault', faultType: '发球违例', label: '发球违例' }),
      loading: busyAction === `/matches/${matchId}/fault`,
      pauseToggle: false,
    },
    {
      label: '接发违例',
      icon: <WarningOutlined />,
      className: 'border-violet-200 text-violet-700 hover:!border-violet-400 hover:!bg-violet-50',
      onClick: () => onOpenSideAction({ action: 'fault', faultType: '接发违例', label: '接发违例' }),
      loading: busyAction === `/matches/${matchId}/fault`,
      pauseToggle: false,
    },
    {
      label: '触网违例',
      icon: <WarningOutlined />,
      className: 'border-violet-200 text-violet-700 hover:!border-violet-400 hover:!bg-violet-50',
      onClick: () => onOpenSideAction({ action: 'fault', faultType: '触网违例', label: '触网违例' }),
      loading: busyAction === `/matches/${matchId}/fault`,
      pauseToggle: false,
    },
    {
      label: '弃权处理',
      icon: <CloseCircleOutlined />,
      className: 'border-red-200 text-red-700 hover:!border-red-400 hover:!bg-red-50',
      onClick: onOpenForfeit,
      loading: false,
      pauseToggle: false,
    },
    {
      label: '伤退/退赛',
      icon: <MedicineBoxOutlined />,
      className: 'border-rose-200 text-rose-700 hover:!border-rose-400 hover:!bg-rose-50',
      onClick: onOpenRetire,
      loading: false,
      pauseToggle: false,
    },
    {
      label: '结束比赛',
      icon: <StopOutlined />,
      className: 'border-red-200 text-red-700 hover:!border-red-400 hover:!bg-red-50',
      onClick: onOpenFinish,
      loading: false,
      pauseToggle: false,
    },
  ];

  return (
    <section className="referee-sub-card min-w-0 rounded-2xl border border-[#E5E7EB] bg-white p-4 shadow-[0_18px_45px_rgba(15,23,42,0.08)] sm:p-5">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-slate-900 text-white">
          <StopOutlined />
        </span>
        <div>
          <h2 className="text-xl font-black text-[#0F172A]">裁判操作</h2>
          <p className="text-sm font-semibold text-[#64748B]">暂停、警告与危险判罚</p>
        </div>
      </div>

      <div className="referee-action-grid mt-5 grid grid-cols-2 gap-2 sm:gap-3">
        {(canSetGameServe ? [serveAction, ...actions] : actions).map((action) => (
          <Button
            key={action.label}
            icon={action.icon}
            disabled={
              matchEnded ||
              (action.pauseToggle && matchStatus !== 'LIVE') ||
              (Boolean(busyAction) && !action.loading) ||
              (!action.pauseToggle && disabled && action.label !== '结束比赛')
            }
            loading={action.loading}
            onClick={action.onClick}
            className={`referee-action-button !h-12 !rounded-2xl !bg-white text-xs !font-black transition active:scale-[0.98] disabled:!border-slate-100 disabled:!bg-slate-50 disabled:!text-slate-300 sm:text-sm ${action.className}`}
          >
            {action.label}
          </Button>
        ))}
      </div>
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

function MatchInfoPanel({
  score,
  side1Score,
  side2Score,
}: {
  score: ScoreState;
  side1Score: number;
  side2Score: number;
}) {
  const status = statusMeta[score.status] ?? statusMeta.PENDING;
  const items = [
    ['比赛状态', score.matchPaused && score.status === 'LIVE' ? '比赛暂停' : status.label],
    ['当前局数', `第 ${currentGameNo(score)} 局`],
    ['总比分', `${score.side1Games} : ${score.side2Games}`],
    ['本局比分', `${side1Score} : ${side2Score}`],
    ['开始时间', formatDateTime(score.scheduledAt)],
    ['场地', score.venue?.name ?? '未排场地'],
  ];

  return (
    <section className="rounded-2xl border border-[#E5E7EB] bg-white p-4 shadow-[0_18px_45px_rgba(15,23,42,0.08)] sm:p-5">
      <h2 className="text-xl font-black text-[#0F172A]">比赛信息</h2>
      <div className="mt-4 space-y-3">
        {items.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-3 rounded-2xl bg-slate-50 px-4 py-3">
            <span className="text-sm font-bold text-[#64748B]">{label}</span>
            <strong className="truncate text-right text-sm font-black text-[#0F172A]">{value}</strong>
          </div>
        ))}
      </div>
    </section>
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
