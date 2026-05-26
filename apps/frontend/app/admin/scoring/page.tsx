'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Button, Card, Empty, Select, Space, Table, Tag, Typography, message } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { apiFetch } from '@/lib/api';
import { roundCn } from '@/lib/round';

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
  matchNo: number;
  status: string;
  refereeId?: string | null;
  side1?: Registration | null;
  side2?: Registration | null;
}

interface BracketData {
  rounds: Array<{ roundNo: number; round: string; matches: MatchItem[] }>;
  groups: Array<{ name: string; matches: MatchItem[] }>;
}

function sideName(side?: Registration | null) {
  if (!side) return '待定';
  return side.player2 ? `${side.player1.name} / ${side.player2.name}` : side.player1.name;
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

  const referees = users.filter((user) => user.role === 'REFEREE');
  const matches = useMemo(() => {
    if (!bracket) return [];
    return [
      ...bracket.rounds.flatMap((round) => round.matches.map((match) => ({ ...match, round: round.round }))),
      ...bracket.groups.flatMap((group) => group.matches.map((match) => ({ ...match, round: group.name }))),
    ];
  }, [bracket]);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    async function loadBase() {
      const [tournamentData, userData] = await Promise.all([
        apiFetch<Tournament[]>('/tournaments', { token }),
        apiFetch<UserItem[]>('/auth/users', { token }),
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

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>裁判分配</Typography.Title>
          <Typography.Text type="secondary">给已生成的场次分配裁判账号，裁判端会自动看到对应场次。</Typography.Text>
        </div>
        <Button icon={<ReloadOutlined />} onClick={loadBracket} loading={loading}>
          刷新
        </Button>
      </div>

      <Card>
        <Space wrap>
          <Select
            style={{ width: 260 }}
            value={selectedTournamentId}
            options={tournaments.map((item) => ({ value: item.id, label: item.name }))}
            onChange={setSelectedTournamentId}
            placeholder="选择赛事"
          />
          <Select
            style={{ width: 220 }}
            value={selectedEventId}
            options={events.map((item) => ({ value: item.id, label: EVENT_TYPE_LABELS[item.type] ?? item.type }))}
            onChange={setSelectedEventId}
            placeholder="选择单项"
          />
        </Space>
      </Card>

      <Card>
        {matches.length ? (
          <Table
            rowKey="id"
            dataSource={matches}
            loading={loading}
            pagination={false}
            columns={[
              { title: '轮次', dataIndex: 'round', render: (value: string) => roundCn(value) },
              { title: '场次', dataIndex: 'matchNo', render: (value) => `第 ${value} 场` },
              { title: '对阵', render: (_, row: MatchItem) => `${sideName(row.side1)} VS ${sideName(row.side2)}` },
              {
                title: '状态',
                dataIndex: 'status',
                render: (value: string) => {
                  const meta = STATUS_LABELS[value] ?? STATUS_LABELS.PENDING;
                  return <Tag color={meta.color}>{meta.label}</Tag>;
                },
              },
              {
                title: '裁判',
                dataIndex: 'refereeId',
                render: (value: string | null, row: MatchItem) => (
                  <Select
                    style={{ width: 260 }}
                    value={value ?? undefined}
                    placeholder="选择裁判"
                    optionLabelProp="label"
                    showSearch
                    filterOption={(input, option) =>
                      String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                    }
                    options={referees.map((item) => ({
                      value: item.id,
                      label: item.username || item.id,
                      title: `已裁 ${item.refereedMatchesCount ?? 0} 场`,
                    }))}
                    optionRender={(option) => {
                      const ref = referees.find((r) => r.id === option.value);
                      const count = ref?.refereedMatchesCount ?? 0;
                      return (
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                          <span style={{ fontWeight: 600 }}>{ref?.username || ref?.id}</span>
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
    </Space>
  );
}
