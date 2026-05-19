'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Alert, Button, Spin, Tag, message } from 'antd';
import { ArrowLeftOutlined, ReloadOutlined, UndoOutlined } from '@ant-design/icons';
import { io, type Socket } from 'socket.io-client';
import { apiFetch } from '@/lib/api';

const API_BASE = process.env.NEXT_PUBLIC_API_URL!;
const SOCKET_BASE = API_BASE.replace(/\/api$/, '');

type GameScore = {
  id: string;
  gameNo: number;
  side1Score: number;
  side2Score: number;
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
  status: 'PENDING' | 'LIVE' | 'COMPLETED';
  winnerSide?: number | null;
  round: string;
  matchNo: number;
  event: {
    typeLabel: string;
    scoringRule: string;
    scoringMode: string;
    tournament: { name: string; edition: number };
  };
  venue?: { id: string; name: string } | null;
  scheduledAt?: string | null;
  durationMinutes: number;
  side1?: { name: string; affiliation: string } | null;
  side2?: { name: string; affiliation: string } | null;
  side1Games: number;
  side2Games: number;
  games: GameScore[];
  currentGame?: GameScore | null;
  events: MatchEventLog[];
};

const statusMeta: Record<ScoreState['status'], { label: string; color: string }> = {
  PENDING: { label: '未开始', color: 'default' },
  LIVE: { label: '进行中', color: 'green' },
  COMPLETED: { label: '已结束', color: 'blue' },
};

const eventLabels: Record<string, string> = {
  POINT: '得分',
  UNDO: '撤销',
  TIMEOUT: '普通暂停',
  MEDICAL_TIMEOUT: '医疗暂停',
  WARNING: '警告',
  YELLOW_CARD: '黄牌',
  SERVE_CHANGE: '发球切换',
};

function sideName(side?: { name: string } | null) {
  return side?.name ?? '待定';
}

export default function RefereeScoringPage() {
  const params = useParams<{ matchId: string }>();
  const matchId = params.matchId;
  const { data: session, status } = useSession();
  const token = session?.user?.accessToken;
  const [score, setScore] = useState<ScoreState | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyAction, setBusyAction] = useState('');
  const [socketStatus, setSocketStatus] = useState<'连接中' | '已连接' | '已断开'>('连接中');

  const currentGame = score?.currentGame ?? score?.games.at(-1) ?? null;
  const disabled = !score || score.status === 'COMPLETED' || busyAction !== '';

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

  if (status === 'loading' || loading || !score) {
    return <div className="grid min-h-screen place-items-center bg-slate-950 text-white"><Spin /></div>;
  }

  if (!token || session?.user?.role !== 'REFEREE') {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-950 px-5 text-white">
        <div className="max-w-md rounded-2xl border border-white/10 bg-white/10 p-6 text-center backdrop-blur">
          <h1 className="text-2xl font-black">裁判记分</h1>
          <p className="mt-3 text-sm text-blue-100">请使用裁判账号登录后操作比分。</p>
          <Link href="/login" className="mt-6 inline-flex h-11 items-center rounded-xl bg-blue-500 px-6 font-black">
            去登录
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#eef6ff] px-4 py-4 text-slate-950 sm:px-6">
      <div className="mx-auto max-w-5xl space-y-4">
        <header className="rounded-2xl border border-blue-100 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Link href="/referee" className="inline-flex items-center gap-2 text-sm font-bold text-blue-700">
              <ArrowLeftOutlined /> 返回场次
            </Link>
            <div className="flex items-center gap-2">
              <Tag color={socketStatus === '已连接' ? 'green' : socketStatus === '连接中' ? 'blue' : 'red'}>
                实时同步：{socketStatus}
              </Tag>
              <Button size="small" icon={<ReloadOutlined />} onClick={loadScore}>
                刷新
              </Button>
            </div>
          </div>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-600">Live Scoring</p>
              <h1 className="mt-1 text-2xl font-black sm:text-3xl">{score.event.typeLabel} 第 {score.matchNo} 场</h1>
              <p className="mt-1 text-sm text-slate-500">
                第{score.event.tournament.edition}届 {score.event.tournament.name} · {score.round}
              </p>
              <p className="mt-1 text-sm font-semibold text-slate-500">
                {score.venue?.name ?? '未排场地'} · {score.scheduledAt ? new Date(score.scheduledAt).toLocaleString('zh-CN') : '未排时间'}
              </p>
            </div>
            <Tag color={statusMeta[score.status].color}>{statusMeta[score.status].label}</Tag>
          </div>
        </header>

        {score.status === 'COMPLETED' && (
          <Alert type="success" showIcon message={`本场已结束，胜方：${winnerName}`} />
        )}

        <section className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_140px_1fr]">
          {[1, 2].map((side) => {
            const isSide1 = side === 1;
            const sideData = isSide1 ? score.side1 : score.side2;
            const sideScore = isSide1 ? currentGame?.side1Score ?? 0 : currentGame?.side2Score ?? 0;
            const gameWins = isSide1 ? score.side1Games : score.side2Games;
            const wonMatch = score.winnerSide === side;
            return (
              <article
                key={side}
                className={`rounded-3xl border p-5 shadow-sm ${
                  wonMatch ? 'border-amber-200 bg-amber-50' : 'border-blue-100 bg-white'
                }`}
              >
                <div className="flex min-h-24 flex-col justify-between">
                  <div>
                    <p className="text-xs font-bold text-slate-400">SIDE {side}</p>
                    <h2 className="mt-2 text-2xl font-black leading-tight">{sideName(sideData)}</h2>
                    <p className="mt-1 text-sm text-slate-500">{sideData?.affiliation ?? ' '}</p>
                  </div>
                  <p className="mt-4 text-sm font-bold text-blue-700">已胜局数：{gameWins}</p>
                </div>

                <div className="mt-5 text-center">
                  <strong className="block text-[5.5rem] font-black leading-none text-blue-700 sm:text-[7rem]">
                    {sideScore}
                  </strong>
                  <Button
                    type="primary"
                    size="large"
                    block
                    disabled={disabled}
                    loading={busyAction === `/matches/${matchId}/point-${side}`}
                    onClick={() => postAction(`/matches/${matchId}/point`, { side })}
                    style={{ height: 60, borderRadius: 16, fontWeight: 900, fontSize: 20 }}
                  >
                    +1
                  </Button>
                </div>
              </article>
            );
          })}

          <aside className="order-first rounded-3xl border border-blue-100 bg-white p-4 text-center shadow-sm md:order-none">
            <p className="text-xs font-bold text-slate-400">当前局</p>
            <strong className="mt-2 block text-4xl font-black text-slate-950">
              第 {currentGame?.gameNo ?? 1} 局
            </strong>
            <div className="mt-4 rounded-2xl bg-blue-50 p-3">
              <p className="text-xs font-bold text-blue-500">局分</p>
              <p className="mt-1 text-3xl font-black text-blue-700">{score.side1Games} : {score.side2Games}</p>
            </div>
            <div className="mt-4 space-y-2">
              <Button
                type="primary"
                block
                disabled={score.status !== 'PENDING'}
                onClick={() => postAction(`/matches/${matchId}/start`)}
              >
                开始比赛
              </Button>
              <Button
                block
                danger
                icon={<UndoOutlined />}
                disabled={!score.events.some((event) => event.type === 'POINT')}
                loading={busyAction === `/matches/${matchId}/undo`}
                onClick={() => postAction(`/matches/${matchId}/undo`)}
              >
                撤销上一分
              </Button>
            </div>
          </aside>
        </section>

        <section className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1fr]">
          <div className="rounded-2xl border border-blue-100 bg-white p-4 shadow-sm">
            <h2 className="text-lg font-black">局分记录</h2>
            <div className="mt-3 divide-y divide-blue-50">
              {score.games.map((game) => (
                <div key={game.id} className="flex items-center justify-between py-3 text-sm">
                  <span className="font-bold text-slate-600">第 {game.gameNo} 局</span>
                  <strong className="text-xl text-blue-700">{game.side1Score} : {game.side2Score}</strong>
                  <span className="w-20 text-right text-xs font-bold text-slate-400">
                    {game.winnerSide ? `胜方 ${game.winnerSide}` : '进行中'}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-blue-100 bg-white p-4 shadow-sm">
            <h2 className="text-lg font-black">过程记录</h2>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button onClick={() => postAction(`/matches/${matchId}/events`, { type: 'TIMEOUT' })}>普通暂停</Button>
              <Button onClick={() => postAction(`/matches/${matchId}/events`, { type: 'MEDICAL_TIMEOUT' })}>医疗暂停</Button>
              <Button onClick={() => postAction(`/matches/${matchId}/events`, { type: 'WARNING' })}>警告</Button>
              <Button onClick={() => postAction(`/matches/${matchId}/events`, { type: 'YELLOW_CARD' })}>黄牌</Button>
              <Button className="col-span-2" onClick={() => postAction(`/matches/${matchId}/events`, { type: 'SERVE_CHANGE' })}>
                发球方切换
              </Button>
            </div>
            <div className="mt-4 max-h-52 space-y-2 overflow-auto">
              {score.events.map((event) => (
                <div key={event.id} className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  <span className="font-black text-slate-800">{eventLabels[event.type] ?? event.type}</span>
                  {event.gameNo ? <span> · 第 {event.gameNo} 局</span> : null}
                  {typeof event.side1Score === 'number' && typeof event.side2Score === 'number' ? (
                    <span> · {event.side1Score}:{event.side2Score}</span>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
