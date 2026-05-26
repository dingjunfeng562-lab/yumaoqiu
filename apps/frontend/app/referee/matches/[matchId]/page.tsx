'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Alert, Button, Input, Modal, Spin, Tag, message } from 'antd';
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
  ReloadOutlined,
  StopOutlined,
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

type ScoreState = {
  id: string;
  status: 'PENDING' | 'LIVE' | 'COMPLETED' | 'CANCELLED';
  winnerSide?: number | null;
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
    tournament: { name: string; edition: number };
  };
  venue?: { id: string; name: string } | null;
  scheduledAt?: string | null;
  durationMinutes: number;
  startedAt?: string | null;
  finishedAt?: string | null;
  side1?: { name: string; affiliation: string } | null;
  side2?: { name: string; affiliation: string } | null;
  side1Games: number;
  side2Games: number;
  games: GameScore[];
  currentGame?: GameScore | null;
  events: MatchEventLog[];
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

function MatchClock({
  startedAt,
  finishedAt,
  status,
}: {
  startedAt?: string | null;
  finishedAt?: string | null;
  status: ScoreState['status'];
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (status !== 'LIVE' || finishedAt) return;
    const handle = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(handle);
  }, [status, finishedAt]);

  if (!startedAt) return null;
  const startMs = new Date(startedAt).getTime();
  if (Number.isNaN(startMs)) return null;
  const endMs = finishedAt ? new Date(finishedAt).getTime() : now;
  const seconds = Math.max(0, Math.floor((endMs - startMs) / 1000));
  const mm = Math.floor(seconds / 60).toString().padStart(2, '0');
  const ss = (seconds % 60).toString().padStart(2, '0');
  return (
    <p className="mt-1 inline-flex items-center gap-1 text-xs font-black tracking-wider text-emerald-700 sm:text-sm">
      <FieldTimeOutlined />
      用时 {mm}:{ss}{finishedAt ? '（已结束）' : ''}
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

function eventDescription(event: MatchEventLog) {
  const label = eventLabels[event.type] ?? event.type;
  const scoreText =
    typeof event.side1Score === 'number' && typeof event.side2Score === 'number'
      ? ` · ${event.side1Score}:${event.side2Score}`
      : '';
  const gameText = event.gameNo ? ` · 第 ${event.gameNo} 局` : '';
  const noteText = event.note ? ` · ${event.note}` : '';
  return `${label}${gameText}${scoreText}${noteText}`;
}

export default function RefereeScoringPage() {
  const params = useParams<{ matchId: string }>();
  const matchId = params.matchId;
  const { data: session, status: sessionStatus } = useSession();
  const token = session?.user?.accessToken;
  const [score, setScore] = useState<ScoreState | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyAction, setBusyAction] = useState('');
  const [socketStatus, setSocketStatus] = useState<'连接中' | '已连接' | '已断开'>('连接中');
  const [forfeitTarget, setForfeitTarget] = useState<1 | 2 | 'both' | null>(null);
  const [forfeitReason, setForfeitReason] = useState('选手未到场弃权');
  const [forfeitChooserOpen, setForfeitChooserOpen] = useState(false);
  const [finishConfirmOpen, setFinishConfirmOpen] = useState(false);

  const currentGame = score ? currentGameOf(score) : null;
  const disabled = !score || score.status === 'COMPLETED' || score.status === 'CANCELLED' || busyAction !== '';

  const winnerName = useMemo(() => {
    if (!score?.winnerSide) return '';
    return score.winnerSide === 1 ? sideName(score.side1) : sideName(score.side2);
  }, [score]);

  async function loadScore() {
    if (!token || !matchId) return;
    setLoading(true);
    try {
      const data = await apiFetch<ScoreState>(`/matches/${matchId}/score`, { token });
      setScore(data);
    } catch (error) {
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
        body: body ? JSON.stringify(body) : undefined,
      });
      setScore(data);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '操作失败');
    } finally {
      setBusyAction('');
    }
  }

  useEffect(() => {
    loadScore();
  }, [token, matchId]);

  useEffect(() => {
    if (!matchId) return;
    const socket: Socket = io(`${SOCKET_BASE}/scores`, {
      transports: ['websocket'],
      withCredentials: true,
    });
    socket.on('connect', () => {
      setSocketStatus('已连接');
      socket.emit('joinMatch', { matchId });
    });
    socket.on('disconnect', () => setSocketStatus('已断开'));
    socket.on('match:update', (nextScore: ScoreState) => {
      if (nextScore.id === matchId) setScore(nextScore);
    });
    return () => {
      socket.emit('leaveMatch', { matchId });
      socket.disconnect();
    };
  }, [matchId]);

  if (sessionStatus === 'loading' || loading || !score) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#07152F] text-white">
        <Spin />
      </div>
    );
  }

  if (!token || session?.user?.role !== 'REFEREE') {
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
  const hasPointEvent = score.events.some((event) => event.type === 'POINT');
  const recentEvents = score.events.slice(0, 10);
  const status = statusMeta[score.status] ?? statusMeta.PENDING;

  return (
    <main className="min-h-screen overflow-x-hidden bg-[linear-gradient(180deg,#F5F8FC_0%,#EEF5FF_54%,#FFFFFF_100%)] text-slate-950">
      <div className="w-full px-3 py-3 sm:px-5 sm:py-4 xl:px-8 2xl:px-10">
        <div className="mx-auto flex w-full max-w-[1920px] flex-col gap-4 sm:gap-5">
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
              message={`选手 ${score.forfeitedSide} 弃权，胜方：${winnerName}`}
              description={score.forfeitReason ?? '选手未到场弃权'}
            />
          ) : score.status === 'COMPLETED' ? (
            <Alert
              type="success"
              showIcon
              className="rounded-2xl border-emerald-200 bg-emerald-50/80"
              message={`本场已结束，胜方：${winnerName}`}
            />
          ) : null}

          <div className="grid min-w-0 grid-cols-1 gap-4 sm:gap-5 xl:grid-cols-[minmax(0,1fr)_360px] 2xl:grid-cols-[minmax(0,1fr)_400px]">
            <div className="min-w-0 space-y-4 sm:space-y-5">
              <section className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.72fr)_minmax(0,1fr)]">
                <div className="order-2 min-w-0 sm:order-2 lg:order-1">
                  <SideScoreCard
                    side={1}
                    accent="blue"
                    name={sideName(score.side1)}
                    affiliation={sideAffiliation(score.side1)}
                    score={side1Score}
                    gamesWon={score.side1Games}
                    server={currentGame?.server === 1}
                    winner={score.winnerSide === 1}
                    disabled={disabled}
                    loading={busyAction === `/matches/${matchId}/point-1`}
                    onPoint={() => postAction(`/matches/${matchId}/point`, { side: 1 })}
                    onUndo={() => postAction(`/matches/${matchId}/undo`)}
                    undoDisabled={!hasPointEvent || Boolean(busyAction)}
                    undoLoading={busyAction === `/matches/${matchId}/undo`}
                  />
                </div>

                <div className="order-1 min-w-0 sm:col-span-2 lg:order-2 lg:col-span-1">
                  <CenterScoreboard
                    score={score}
                    side1Score={side1Score}
                    side2Score={side2Score}
                    onStart={() => postAction(`/matches/${matchId}/start`)}
                    startDisabled={score.status !== 'PENDING' || Boolean(busyAction)}
                  />
                </div>

                <div className="order-3 min-w-0 lg:order-3">
                  <SideScoreCard
                    side={2}
                    accent="red"
                    name={sideName(score.side2)}
                    affiliation={sideAffiliation(score.side2)}
                    score={side2Score}
                    gamesWon={score.side2Games}
                    server={currentGame?.server === 2}
                    winner={score.winnerSide === 2}
                    disabled={disabled}
                    loading={busyAction === `/matches/${matchId}/point-2`}
                    onPoint={() => postAction(`/matches/${matchId}/point`, { side: 2 })}
                    onUndo={() => postAction(`/matches/${matchId}/undo`)}
                    undoDisabled={!hasPointEvent || Boolean(busyAction)}
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
                  onAction={postAction}
                  onOpenForfeit={() => setForfeitChooserOpen(true)}
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
              <EventLogPanel events={recentEvents} />
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

      <Modal
        open={finishConfirmOpen}
        title="确认结束比赛"
        okText="我已确认"
        cancelText="取消"
        okButtonProps={{ danger: true }}
        onCancel={() => setFinishConfirmOpen(false)}
        onOk={() => {
          setFinishConfirmOpen(false);
          message.info('当前比赛会在达到胜局或弃权判定后自动结束，请继续按现有计分规则操作。');
        }}
      >
        <div className="space-y-3">
          <p className="text-sm font-semibold text-slate-700">
            结束比赛属于不可逆危险操作。当前系统没有单独的手动结束接口，比赛状态仍按现有业务逻辑由比分或弃权自动判定。
          </p>
          <Alert
            type="warning"
            showIcon
            message="不会直接修改比赛状态"
            description="请通过继续计分达到胜局，或使用弃权处理完成比赛。"
          />
        </div>
      </Modal>
    </main>
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
  const status = statusMeta[score.status] ?? statusMeta.PENDING;
  const socketTone =
    socketStatus === '已连接'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
      : socketStatus === '连接中'
        ? 'border-blue-200 bg-blue-50 text-blue-700'
        : 'border-red-200 bg-red-50 text-red-700';

  return (
    <header className="overflow-hidden rounded-2xl border border-[#E5E7EB] bg-white shadow-[0_18px_45px_rgba(15,23,42,0.08)]">
      <div className="flex min-w-0 flex-col gap-4 border-b border-slate-100 px-3 py-3 sm:px-5 sm:py-4 lg:flex-row lg:items-center lg:justify-between xl:px-6">
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
          <Link
            href="/referee/my-matches"
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
              <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-3 py-1 text-xs font-black text-red-600">
                <span className="h-2 w-2 rounded-full bg-red-500 shadow-[0_0_0_4px_rgba(239,68,68,0.14)]" />
                实时计分中
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
            <MatchClock startedAt={score.startedAt} finishedAt={score.finishedAt} status={score.status} />
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
          <span className={`inline-flex h-10 items-center justify-center rounded-xl px-4 text-xs font-black sm:text-sm ${status.tone}`}>
            {status.label}
          </span>
        </div>
      </div>
    </header>
  );
}

function SideScoreCard({
  side,
  accent,
  name,
  affiliation,
  score,
  gamesWon,
  server,
  winner,
  disabled,
  loading,
  onPoint,
  onUndo,
  undoDisabled,
  undoLoading,
}: {
  side: 1 | 2;
  accent: 'blue' | 'red';
  name: string;
  affiliation: string;
  score: number;
  gamesWon: number;
  server: boolean;
  winner: boolean;
  disabled: boolean;
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

  return (
    <article className={`min-w-0 overflow-hidden rounded-2xl border border-[#E5E7EB] bg-white shadow-[0_18px_45px_rgba(15,23,42,0.08)] ring-1 ${ringTone}`}>
      <div className={`flex h-12 items-center justify-between px-5 text-white ${topBar}`}>
        <span className="text-sm font-black uppercase tracking-[0.18em]">SIDE {side}</span>
        <div className="flex items-center gap-2">
          {server ? <span className="rounded-full bg-white/20 px-2.5 py-1 text-xs font-black">发球</span> : null}
          {winner ? <TrophyOutlined className="text-yellow-200" /> : null}
        </div>
      </div>

      <div className="flex min-h-[300px] flex-col p-4 sm:min-h-[340px] sm:p-5 xl:min-h-[430px]">
        <div className="min-w-0">
          <h2 className="truncate text-xl font-black text-[#0F172A] sm:text-2xl xl:text-3xl">{name}</h2>
          <p className="mt-2 truncate text-sm font-bold text-[#64748B]">级别：{affiliation}</p>
        </div>

        <div className="my-4 flex flex-1 flex-col items-center justify-center rounded-2xl bg-slate-50/80 px-3 py-4 sm:my-7 sm:px-4 sm:py-6">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">本局比分</p>
          <strong className={`mt-2 block text-[5.5rem] font-black leading-none tracking-tight sm:text-[7.5rem] xl:text-[9rem] ${scoreTone}`}>
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
            className={`!h-12 !rounded-2xl !border-0 text-lg !font-black text-white shadow-[0_14px_28px_rgba(37,99,235,0.24)] transition active:scale-[0.99] disabled:!bg-slate-200 disabled:!text-slate-400 sm:!h-14 sm:text-xl ${buttonTone}`}
          >
            +1 得分
          </Button>
          <Button
            block
            icon={<UndoOutlined />}
            disabled={undoDisabled}
            loading={undoLoading}
            onClick={onUndo}
            className="!h-12 !rounded-2xl border-slate-200 !font-black text-slate-600 transition hover:!border-slate-300 hover:!bg-slate-50 active:scale-[0.99] disabled:!bg-slate-50 disabled:!text-slate-300"
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
  side1Score,
  side2Score,
  onStart,
  startDisabled,
}: {
  score: ScoreState;
  side1Score: number;
  side2Score: number;
  onStart: () => void;
  startDisabled: boolean;
}) {
  const status = statusMeta[score.status] ?? statusMeta.PENDING;

  return (
    <article className="min-w-0 overflow-hidden rounded-2xl border border-[#0F172A]/10 bg-[#07152F] text-white shadow-[0_24px_60px_rgba(15,23,42,0.22)]">
      <div className="flex h-full min-h-[300px] flex-col p-4 sm:min-h-[360px] sm:p-5 lg:min-h-[430px]">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-center sm:p-4">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-blue-200">比赛总览</p>
          <div className="mt-4 flex items-center justify-center gap-3 sm:mt-7 sm:gap-5">
            <span className="text-[4.2rem] font-black leading-none text-[#60A5FA] sm:text-[5.5rem] xl:text-[6.5rem]">{side1Score}</span>
            <span className="pb-2 text-4xl font-black text-white sm:pb-3 sm:text-5xl">:</span>
            <span className="text-[4.2rem] font-black leading-none text-[#F87171] sm:text-[5.5rem] xl:text-[6.5rem]">{side2Score}</span>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:mt-6 sm:gap-3">
            <div className="rounded-xl bg-white/8 px-3 py-3">
              <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">当前局</p>
              <p className="mt-1 text-xl font-black text-white sm:text-2xl">第 {currentGameNo(score)} 局</p>
            </div>
            <div className="rounded-xl bg-white/8 px-3 py-3">
              <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">比赛状态</p>
              <p className="mt-1 text-xl font-black text-white sm:text-2xl">{status.label}</p>
            </div>
          </div>
        </div>

        <div className="mt-auto pt-5">
          <Button
            type="primary"
            block
            icon={<PlayCircleFilled />}
            disabled={startDisabled}
            onClick={onStart}
            className="!h-12 !rounded-2xl !border-0 !bg-[#22C55E] text-base !font-black text-white shadow-[0_16px_30px_rgba(34,197,94,0.24)] transition hover:!bg-emerald-400 active:scale-[0.99] disabled:!bg-slate-600 disabled:!text-slate-300 sm:!h-14 sm:text-lg"
          >
            开始比赛
          </Button>
          <p className="mt-4 text-center text-sm font-semibold text-slate-300">
            {score.status === 'PENDING'
              ? '比赛未开始，点击开始比赛计分'
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
  return (
    <section className="min-w-0 rounded-2xl border border-[#E5E7EB] bg-white p-4 shadow-[0_18px_45px_rgba(15,23,42,0.08)] sm:p-5">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-blue-50 text-[#2563EB]">
          <FieldTimeOutlined />
        </span>
        <div>
          <h2 className="text-xl font-black text-[#0F172A]">局分记录</h2>
          <p className="text-sm font-semibold text-[#64748B]">每局比分与胜局状态</p>
        </div>
      </div>

      <div className="mt-5 space-y-3">
        {recordItems(score).map((game) => {
          const statusText = game.winnerSide ? `胜方 SIDE ${game.winnerSide}` : game.active ? '进行中' : '未开始';
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
  onAction,
  onOpenForfeit,
  onOpenFinish,
}: {
  matchId: string;
  busyAction: string;
  disabled: boolean;
  onAction: (path: string, body?: Record<string, unknown>) => void;
  onOpenForfeit: () => void;
  onOpenFinish: () => void;
}) {
  const actions = [
    {
      label: '普通暂停',
      icon: <PauseCircleOutlined />,
      className: 'border-blue-200 text-blue-700 hover:!border-blue-400 hover:!bg-blue-50',
      onClick: () => onAction(`/matches/${matchId}/events`, { type: 'TIMEOUT' }),
      loading: busyAction === `/matches/${matchId}/events-timeout`,
    },
    {
      label: '医疗暂停',
      icon: <MedicineBoxOutlined />,
      className: 'border-emerald-200 text-emerald-700 hover:!border-emerald-400 hover:!bg-emerald-50',
      onClick: () => onAction(`/matches/${matchId}/events`, { type: 'MEDICAL_TIMEOUT' }),
      loading: false,
    },
    {
      label: '警告',
      icon: <WarningOutlined />,
      className: 'border-orange-200 text-orange-700 hover:!border-orange-400 hover:!bg-orange-50',
      onClick: () => onAction(`/matches/${matchId}/events`, { type: 'WARNING' }),
      loading: false,
    },
    {
      label: '黄牌',
      icon: <ExclamationCircleOutlined />,
      className: 'border-yellow-200 text-yellow-700 hover:!border-yellow-400 hover:!bg-yellow-50',
      onClick: () => onAction(`/matches/${matchId}/events`, { type: 'YELLOW_CARD' }),
      loading: false,
    },
    {
      label: '弃权处理',
      icon: <CloseCircleOutlined />,
      className: 'border-red-200 text-red-700 hover:!border-red-400 hover:!bg-red-50',
      onClick: onOpenForfeit,
      loading: false,
    },
    {
      label: '结束比赛',
      icon: <StopOutlined />,
      className: 'border-red-200 text-red-700 hover:!border-red-400 hover:!bg-red-50',
      onClick: onOpenFinish,
      loading: false,
    },
  ];

  return (
    <section className="min-w-0 rounded-2xl border border-[#E5E7EB] bg-white p-4 shadow-[0_18px_45px_rgba(15,23,42,0.08)] sm:p-5">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-slate-900 text-white">
          <StopOutlined />
        </span>
        <div>
          <h2 className="text-xl font-black text-[#0F172A]">裁判操作</h2>
          <p className="text-sm font-semibold text-[#64748B]">暂停、警告与危险判罚</p>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-2 sm:gap-3">
        {actions.map((action) => (
          <Button
            key={action.label}
            icon={action.icon}
            disabled={disabled && action.label !== '结束比赛'}
            loading={action.loading}
            onClick={action.onClick}
            className={`!h-12 !rounded-2xl !bg-white text-xs !font-black transition active:scale-[0.98] disabled:!border-slate-100 disabled:!bg-slate-50 disabled:!text-slate-300 sm:text-sm ${action.className}`}
          >
            {action.label}
          </Button>
        ))}
      </div>
    </section>
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
    ['比赛状态', status.label],
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

function EventLogPanel({ events }: { events: MatchEventLog[] }) {
  const pointEvents = events.filter((event) => event.type === 'POINT');
  const timeoutEvents = events.filter((event) => event.type === 'TIMEOUT' || event.type === 'MEDICAL_TIMEOUT');
  const warningEvents = events.filter((event) => event.type === 'WARNING' || event.type === 'YELLOW_CARD' || event.type === 'FORFEIT');

  return (
    <section className="rounded-2xl border border-[#E5E7EB] bg-white p-4 shadow-[0_18px_45px_rgba(15,23,42,0.08)] sm:p-5">
      <h2 className="text-xl font-black text-[#0F172A]">操作记录</h2>
      <div className="mt-4 space-y-4">
        <LogGroup title="最近得分记录" events={pointEvents} emptyText="暂无得分记录" />
        <LogGroup title="暂停记录" events={timeoutEvents} emptyText="暂无暂停记录" />
        <LogGroup title="警告记录" events={warningEvents} emptyText="暂无警告记录" />
      </div>
    </section>
  );
}

function LogGroup({
  title,
  events,
  emptyText,
}: {
  title: string;
  events: MatchEventLog[];
  emptyText: string;
}) {
  return (
    <div>
      <p className="text-sm font-black text-[#0F172A]">{title}</p>
      <div className="mt-2 space-y-2">
        {events.length ? (
          events.slice(0, 4).map((event) => (
            <div key={event.id} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
              <p className="truncate text-xs font-bold text-slate-700">{eventDescription(event)}</p>
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
