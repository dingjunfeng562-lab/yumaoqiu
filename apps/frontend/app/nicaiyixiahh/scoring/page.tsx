'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import dayjs from 'dayjs';
import { Button, Card, Empty, InputNumber, Modal, Select, Space, Table, Tag, Typography, message } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { apiFetch } from '@/lib/api';
import { roundCn } from '@/lib/round';
import TournamentRefereeQr from '@/components/referee/TournamentRefereeQr';

const EVENT_TYPE_LABELS: Record<string, string> = {
  MENS_SINGLES: '男子单打',
  WOMENS_SINGLES: '女子单打',
  MENS_DOUBLES: '男子双打',
  WOMENS_DOUBLES: '女子双打',
  MIXED_DOUBLES: '混合双打',
};

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  PENDING: { label: '未开始', color: 'default' },
  LIVE: { label: '进行中', color: 'green' },
  COMPLETED: { label: '已结束', color: 'blue' },
};

interface Tournament {
  id: string;
  name: string;
  edition: number;
}

interface EventItem {
  id: string;
  tournamentId: string;
  type: string;
}

interface UserItem {
  id: string;
  username?: string | null;
  email?: string | null;
  role: string;
  refereedMatchesCount?: number;
}

interface Registration {
  id: string;
  player1: { name: string; affiliation: string };
  player2?: { name: string; affiliation: string } | null;
}

interface MatchItem {
  id: string;
  round: string;
  roundNo?: number;
  matchNo: number;
  status: string;
  scheduledAt?: string | null;
  refereeId?: string | null;
  games?: GameScore[];
  side1?: Registration | null;
  side2?: Registration | null;
}

interface GameScore {
  gameNo: number;
  side1Score: number;
  side2Score: number;
}

interface MatchScoreState {
  event: {
    scoringRule: string;
    customGamesToWin?: number | null;
  };
  games: GameScore[];
}

interface BracketData {
  rounds: Array<{ roundNo: number; round: string; matches: MatchItem[] }>;
  groups: Array<{ name: string; matches: MatchItem[] }>;
  // 第二阶段（小组赛排位赛）的正式比赛，需在此分配裁判 / 记分。
  secondStageFormalMatches?: MatchItem[];
}

function refereeAccountLabel(referee: UserItem) {
  return `账号：${referee.username || referee.email || referee.id}`;
}

function matchScoreText(games?: GameScore[]) {
  return games?.length
    ? games.map((game) => `${game.side1Score}:${game.side2Score}`).join(' / ')
    : '未记分';
}

function sideName(side?: Registration | null) {
  if (!side) return '待定';
  return side.player2 ? `${side.player1.name} / ${side.player2.name}` : side.player1.name;
}

function matchStageLabel(row: MatchItem) {
  const round = row.round?.trim();
  if (!round) return '—';
  if (row.roundNo === 0) return round.endsWith('组') ? round : `${round}组`;
  return roundCn(round);
}

function formatTime(value?: string | null) {
  return value ? dayjs(value).format('YYYY-MM-DD HH:mm') : '待排时间';
}

export default function AdminScoringPage() {
  const { data: session } = useSession();
  const token = session?.user?.accessToken;
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [users, setUsers] = useState<UserItem[]>([]);
  const [selectedTournamentId, setSelectedTournamentId] = useState('');
  const [selectedEventId, setSelectedEventId] = useState('');
  const [bracket, setBracket] = useState<BracketData | null>(null);
  const [loading, setLoading] = useState(false);
  const [scoreTarget, setScoreTarget] = useState<MatchItem | null>(null);
  const [scoreGames, setScoreGames] = useState<GameScore[]>([]);
  const [scoreLoadingId, setScoreLoadingId] = useState('');
  const [scoreSaving, setScoreSaving] = useState(false);

  const referees = users.filter((user) => user.role === 'REFEREE');
  const matches = useMemo(() => {
    if (!bracket) return [];
    return [
      ...bracket.rounds.flatMap((round) => round.matches.map((match) => ({ ...match, round: round.round }))),
      ...bracket.groups.flatMap((group) => group.matches.map((match) => ({ ...match, round: group.name }))),
      ...(bracket.secondStageFormalMatches ?? []),
    ];
  }, [bracket]);
  useEffect(() => {
    if (!token) return;
    let alive = true;
    async function loadBase() {
      const [tournamentData, userData] = await Promise.all([
        apiFetch<Tournament[]>('/tournaments', { token }),
        apiFetch<UserItem[]>('/scoring/referees', { token }),
      ]);
      if (!alive) return;
      setTournaments(tournamentData);
      setUsers(userData);
      setSelectedTournamentId(tournamentData[0]?.id ?? '');
    }
    loadBase().catch((error) => message.error(error instanceof Error ? error.message : '加载基础数据失败'));
    return () => {
      alive = false;
    };
  }, [token]);

  useEffect(() => {
    if (!token || !selectedTournamentId) return;
    let alive = true;
    async function loadEvents() {
      const data = await apiFetch<EventItem[]>(`/events?tournamentId=${selectedTournamentId}`, { token });
      if (!alive) return;
      setEvents(data);
      setSelectedEventId(data[0]?.id ?? '');
    }
    loadEvents().catch((error) => message.error(error instanceof Error ? error.message : '加载单项失败'));
    return () => {
      alive = false;
    };
  }, [token, selectedTournamentId]);

  async function loadBracket() {
    if (!token || !selectedEventId) return;
    setLoading(true);
    try {
      const data = await apiFetch<BracketData>(`/events/${selectedEventId}/bracket`, { token });
      setBracket(data);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载场次失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadBracket();
  }, [token, selectedEventId]);

  async function assignReferee(matchId: string, refereeId: string) {
    if (!token) return;
    try {
      await apiFetch(`/matches/${matchId}/referee`, {
        method: 'PATCH',
        token,
        body: JSON.stringify({ refereeId }),
      });
      message.success('裁判已分配');
      await loadBracket();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '分配裁判失败');
    }
  }

  async function openScoreEditor(match: MatchItem) {
    if (!token) return;
    setScoreLoadingId(match.id);
    try {
      const state = await apiFetch<MatchScoreState>(`/matches/${match.id}/score`, { token });
      const gamesToWin = state.event.customGamesToWin
        ?? (state.event.scoringRule === 'FIFTEEN_ONE' ? 1 : 2);
      const rowCount = Math.max(gamesToWin * 2 - 1, state.games.length, 1);
      const existing = new Map(state.games.map((game) => [game.gameNo, game]));
      setScoreGames(Array.from({ length: rowCount }, (_, index) => (
        existing.get(index + 1) ?? { gameNo: index + 1, side1Score: 0, side2Score: 0 }
      )));
      setScoreTarget(match);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载比分失败');
    } finally {
      setScoreLoadingId('');
    }
  }

  function updateGameScore(gameNo: number, side: 1 | 2, value: number | null) {
    const score = Math.max(0, Math.trunc(value ?? 0));
    setScoreGames((current) => current.map((game) => (
      game.gameNo === gameNo
        ? { ...game, [side === 1 ? 'side1Score' : 'side2Score']: score }
        : game
    )));
  }

  async function saveScore() {
    if (!token || !scoreTarget) return;
    setScoreSaving(true);
    try {
      await apiFetch(`/matches/${scoreTarget.id}/score`, {
        method: 'PATCH',
        token,
        body: JSON.stringify({
          games: scoreGames.map(({ side1Score, side2Score }) => ({ side1Score, side2Score })),
        }),
      });
      message.success('比分已更新');
      setScoreTarget(null);
      await loadBracket();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '更新比分失败');
    } finally {
      setScoreSaving(false);
    }
  }


  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>裁判分配</Typography.Title>
          <Typography.Text type="secondary">裁判可扫码选择场地执裁，也可继续在下方手动分配裁判。</Typography.Text>
        </div>
        <Button icon={<ReloadOutlined />} onClick={loadBracket} loading={loading}>
          刷新
        </Button>
      </div>

      <Card style={{ marginTop: 16, marginBottom: 16 }}>
        <div className="flex flex-wrap items-center justify-between gap-4">
        <Space wrap>
          <Select
            style={{ width: 260 }}
            value={selectedTournamentId}
            options={tournaments.map((item) => ({ value: item.id, label: item.name }))}
            onChange={(value) => {
              setSelectedTournamentId(value);
            }}
            placeholder="选择赛事"
          />
          <Select
            style={{ width: 220 }}
            value={selectedEventId}
            options={events.map((item) => ({ value: item.id, label: EVENT_TYPE_LABELS[item.type] ?? item.type }))}
            onChange={(value) => {
              setSelectedEventId(value);
            }}
            placeholder="选择单项"
          />
        </Space>
        <TournamentRefereeQr
          tournamentId={selectedTournamentId}
          name={tournaments.find((item) => item.id === selectedTournamentId)?.name}
        />
        </div>
      </Card>

      <Card>
        {matches.length ? (
          <Table
            rowKey="id"
            dataSource={matches}
            loading={loading}
            pagination={false}
            tableLayout="fixed"
            columns={[
              { title: '组别/轮次', render: (_, row: MatchItem) => matchStageLabel(row) },
              { title: '时间', dataIndex: 'scheduledAt', render: (value: string | null) => formatTime(value) },
              { title: '场次', dataIndex: 'matchNo', render: (value) => `第 ${value} 场` },
              { title: '对阵', render: (_, row: MatchItem) => `${sideName(row.side1)} VS ${sideName(row.side2)}` },
              {
                title: '比分',
                width: 210,
                render: (_, row: MatchItem) => (
                  <Space size={4} wrap>
                    <Typography.Text strong>{matchScoreText(row.games)}</Typography.Text>
                    <Button
                      type="link"
                      size="small"
                      loading={scoreLoadingId === row.id}
                      disabled={!row.side1 || !row.side2 || row.status === 'CANCELLED'}
                      onClick={() => openScoreEditor(row)}
                    >
                      修改
                    </Button>
                  </Space>
                ),
              },
              {
                title: '状态',
                dataIndex: 'status',
                render: (value: string) => {
                  const meta = STATUS_LABELS[value] ?? STATUS_LABELS.PENDING;
                  return <Tag color={meta.color}>{meta.label}</Tag>;
                },
              },
              {
                title: '执裁账号',
                dataIndex: 'refereeId',
                render: (value: string | null, row: MatchItem) => (
                  <Select
                    style={{ width: '100%' }}
                    value={value ?? undefined}
                    placeholder="选择执裁账号"
                    optionLabelProp="label"
                    showSearch
                    filterOption={(input, option) =>
                      String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                    }
                    options={referees.map((item) => ({
                      value: item.id,
                      label: refereeAccountLabel(item),
                      title: `已裁 ${item.refereedMatchesCount ?? 0} 场`,
                    }))}
                    optionRender={(option) => {
                      const ref = referees.find((r) => r.id === option.value);
                      const count = ref?.refereedMatchesCount ?? 0;
                      return (
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                          <span style={{ fontWeight: 600 }}>{ref ? refereeAccountLabel(ref) : option.label}</span>
                          <Tag color={count > 0 ? 'blue' : 'default'} style={{ marginInlineEnd: 0 }}>
                            已裁 {count} 场
                          </Tag>
                        </div>
                      );
                    }}
                    onChange={(nextRefereeId) => assignReferee(row.id, nextRefereeId)}
                  />
                ),
              },
            ]}
          />
        ) : (
          <Empty description="暂无场次，请先在抽签编排中生成对阵" />
        )}
      </Card>

      <Modal
        title="修改比赛比分"
        open={Boolean(scoreTarget)}
        okText="保存比分"
        cancelText="取消"
        confirmLoading={scoreSaving}
        onOk={saveScore}
        onCancel={() => !scoreSaving && setScoreTarget(null)}
      >
        {scoreTarget && (
          <div className="space-y-4">
            <Typography.Text type="secondary">
              {sideName(scoreTarget.side1)} VS {sideName(scoreTarget.side2)}
            </Typography.Text>
            <div className="space-y-3">
              {scoreGames.map((game) => (
                <div key={game.gameNo} className="grid grid-cols-[64px_1fr_20px_1fr] items-center gap-2">
                  <Typography.Text>第 {game.gameNo} 局</Typography.Text>
                  <InputNumber
                    min={0}
                    max={999}
                    precision={0}
                    value={game.side1Score}
                    onChange={(value) => updateGameScore(game.gameNo, 1, value)}
                    style={{ width: '100%' }}
                  />
                  <span className="text-center font-bold text-slate-400">:</span>
                  <InputNumber
                    min={0}
                    max={999}
                    precision={0}
                    value={game.side2Score}
                    onChange={(value) => updateGameScore(game.gameNo, 2, value)}
                    style={{ width: '100%' }}
                  />
                </div>
              ))}
            </div>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
              保存后会按本场计分规则重新判定每局及整场胜负；未进行的后续局请保持 0:0。
            </Typography.Paragraph>
          </div>
        )}
      </Modal>
    </div>
  );
}
