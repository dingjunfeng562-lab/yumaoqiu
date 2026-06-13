'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import {
  Alert,
  Button,
  Col,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  BranchesOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  DeleteOutlined,
  EyeInvisibleOutlined,
  FileDoneOutlined,
  PlusOutlined,
  ReloadOutlined,
  StarFilled,
  SwapOutlined,
  TrophyOutlined,
} from '@ant-design/icons';
import { apiFetch } from '@/lib/api';
import { roundCn } from '@/lib/round';
import {
  KnockoutBracket,
  type BracketMatch,
  type BracketParticipant,
  type KnockoutBracketData,
} from '@/components/bracket/KnockoutBracket';
import { SecondStageBracket, type SecondStageData } from '@/components/bracket/SecondStageBracket';

const EVENT_TYPE_LABELS: Record<string, string> = {
  MENS_SINGLES: '男子单打',
  WOMENS_SINGLES: '女子单打',
  MENS_DOUBLES: '男子双打',
  WOMENS_DOUBLES: '女子双打',
  MIXED_DOUBLES: '混合双打',
};

const FORMAT_LABELS: Record<string, string> = {
  SINGLE_ELIMINATION: '单淘汰制',
  GROUP_PLUS_KNOCKOUT: '小组赛 + 淘汰赛',
  ROUND_ROBIN: '单循环排名赛',
  GROUP_PLUS_PLAYOFF: '小组循环 + 交叉排位',
  SINGLE_ELIMINATION_PLUS_GROUP_RANKING: '单淘汰 + 小组赛排位赛',
};


const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  PENDING: { label: '待排程', color: 'default' },
  LIVE: { label: '进行中', color: 'red' },
  COMPLETED: { label: '已结束', color: 'blue' },
  CANCELLED: { label: '已取消', color: 'default' },
};

const CIRCLED_SEEDS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩', '⑪', '⑫', '⑬', '⑭', '⑮', '⑯'];
const SECOND_STAGE_SLOT_CODES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
// 选中此哨兵值或留空，表示该 A-H 签位轮空（无选手）。
const SECOND_STAGE_BYE = '__BYE__';

interface Tournament {
  id: string;
  name: string;
  edition: number;
}

interface EventItem {
  id: string;
  tournamentId: string;
  type: string;
  format: string;
  groupSize?: number | null;
  qualifiersPerGroup?: number | null;
  drawLocked: boolean;
  drawPublished: boolean;
  drawGeneratedAt?: string | null;
}

interface Player {
  id: string;
  name: string;
  gender: 'MALE' | 'FEMALE';
  affiliation: string;
}

interface Registration {
  id: string;
  player1: Player;
  player2?: Player | null;
  isSeed: boolean;
  seedRank?: number | null;
  groupName?: string | null;
  createdAt?: string;
}

interface DrawBracket {
  id: string;
  status: string;
  version: number;
  bracketSize: number;
}

interface MatchItem {
  id: string;
  round: string;
  roundNo: number;
  matchNo: number;
  side1?: Registration | null;
  side2?: Registration | null;
  status: string;
  winnerSide?: number | null;
}

interface RoundItem {
  roundNo: number;
  round: string;
  matches: MatchItem[];
}

interface GroupItem {
  name: string;
  registrations: Registration[];
  matches: MatchItem[];
}

interface BracketData {
  event: EventItem;
  currentDraw?: DrawBracket | null;
  registrations: Registration[];
  rounds: RoundItem[];
  groups: GroupItem[];
  secondStage?: SecondStageData | null;
}

interface RedrawRequestItem {
  id: string;
  eventItemId: string;
  drawBracketId: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  reason: string | null;
  requesterId: string;
  requesterNameSnapshot: string | null;
  decidedById: string | null;
  decidedByNameSnapshot: string | null;
  decisionRemark: string | null;
  decidedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function seedMark(seed?: number | null) {
  if (!seed) return '';
  return CIRCLED_SEEDS[seed - 1] ?? `(${seed})`;
}

function sideName(registration?: Registration | null) {
  if (!registration) return '';
  const name = registration.player2
    ? `${registration.player1.name} / ${registration.player2.name}`
    : registration.player1.name;
  return `${name}${registration.isSeed ? ` ${seedMark(registration.seedRank)}` : ''}`;
}

function affiliation(registration?: Registration | null) {
  if (!registration) return '';
  return registration.player2
    ? `${registration.player1.affiliation} / ${registration.player2.affiliation}`
    : registration.player1.affiliation;
}

function sourceLabel(rounds: RoundItem[], match: MatchItem, sideNo: 1 | 2) {
  if (match.roundNo <= 1) return '轮空';
  const previousRound = rounds.find((round) => round.roundNo === match.roundNo - 1);
  const previousMatchNo = match.matchNo * 2 - (sideNo === 1 ? 1 : 0);
  const previousRoundName = roundCn(previousRound?.round ?? `R${match.roundNo - 1}`);
  return `${previousRoundName} 第 ${previousMatchNo} 场胜者`;
}

function isDoublesEvent(type?: string) {
  return ['MENS_DOUBLES', 'WOMENS_DOUBLES', 'MIXED_DOUBLES'].includes(type ?? '');
}

function isSingleElimination(event?: EventItem) {
  return ['SINGLE_ELIMINATION', 'SINGLE_ELIMINATION_PLUS_GROUP_RANKING'].includes(event?.format ?? '');
}

function statusMeta(status: string) {
  return STATUS_LABELS[status] ?? STATUS_LABELS.PENDING;
}

function toBracketParticipant(
  registration: Registration | null | undefined,
  position: number,
): BracketParticipant {
  if (!registration) {
    return {
      id: `bye-position-${position}`,
      position,
      name: '— 轮空 —',
      isBye: true,
    };
  }

  return {
    id: registration.id,
    position,
    name: sideName(registration),
    seed: registration.seedRank ?? null,
    isBye: false,
    affiliation: affiliation(registration),
  };
}

function toKnockoutBracketData(data: BracketData): KnockoutBracketData {
  const firstRound = [...(data.rounds.find((round) => round.roundNo === 1)?.matches ?? [])].sort(
    (a, b) => a.matchNo - b.matchNo,
  );
  const participants = firstRound.flatMap((match, index) => [
    toBracketParticipant(match.side1, index * 2 + 1),
    toBracketParticipant(match.side2, index * 2 + 2),
  ]);
  const matches: BracketMatch[] = data.rounds.flatMap((round) =>
    round.matches.map((match) => ({
      id: match.id,
      roundNo: match.roundNo,
      roundLabel: roundCn(match.round),
      matchNo: match.matchNo,
      status: match.status,
      side1Id: match.side1?.id ?? null,
      side2Id: match.side2?.id ?? null,
      winnerSide: match.winnerSide ?? null,
      winnerId: match.winnerSide === 1 ? match.side1?.id ?? null : match.winnerSide === 2 ? match.side2?.id ?? null : null,
    })),
  );

  return {
    id: data.event.id,
    tournamentId: data.event.tournamentId,
    title: `${EVENT_TYPE_LABELS[data.event.type] ?? data.event.type} 对阵图`,
    subtitle: `${FORMAT_LABELS[data.event.format] ?? data.event.format} · ${participants.filter((item) => !item.isBye).length} 个签位`,
    generatedAt: data.event.drawGeneratedAt ?? null,
    participants,
    matches,
  };
}

function MatchCard({
  match,
  rounds,
}: {
  match: MatchItem;
  rounds: RoundItem[];
}) {
  const normalized = match.status || 'PENDING';
  const isLive = normalized === 'LIVE';
  const isCompleted = normalized === 'COMPLETED';
  const isFinal = match.round === 'F';
  const finalWinner = isFinal && isCompleted && match.winnerSide;
  const cardBorder = finalWinner
    ? '1px solid #f59e0b'
    : isLive
      ? '1px solid #ef4444'
      : '1px solid #d8e6ff';

  return (
    <div
      style={{
        width: 236,
        border: cardBorder,
        borderRadius: 8,
        background: '#fff',
        boxShadow: finalWinner
          ? '0 0 0 3px rgba(245,158,11,0.12), 0 12px 28px rgba(245,158,11,0.18)'
          : '0 8px 22px rgba(30, 90, 180, 0.08)',
        overflow: 'hidden',
      }}
    >
      <div style={{ padding: '8px 10px', background: isLive ? '#fff1f2' : '#f0f6ff' }}>
        <Space style={{ width: '100%', justifyContent: 'space-between' }}>
          <Typography.Text strong style={{ color: isLive ? '#dc2626' : '#1d4ed8' }}>
            第 {match.matchNo} 场
          </Typography.Text>
          <Tag color={statusMeta(normalized).color}>{isLive ? 'LIVE' : statusMeta(normalized).label}</Tag>
        </Space>
      </div>
      {[1, 2].map((sideNo) => {
        const side = sideNo === 1 ? match.side1 : match.side2;
        const winner = match.winnerSide === sideNo;
        const loser = isCompleted && match.winnerSide && !winner;
        const placeholder = sideNo === 1 ? sourceLabel(rounds, match, 1) : sourceLabel(rounds, match, 2);
        return (
          <div
            key={sideNo}
            style={{
              minHeight: 58,
              padding: '10px 12px',
              borderTop: '1px solid #eef4ff',
              background: side ? (winner ? '#fff7e6' : '#fff') : '#f8fafc',
            }}
          >
            {side ? (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <Typography.Text
                    strong={winner}
                    delete={Boolean(loser)}
                    style={{ color: loser ? '#94a3b8' : '#111827' }}
                  >
                    {side.isSeed && <StarFilled style={{ color: '#2563eb', marginRight: 4 }} />}
                    {sideName(side)}
                  </Typography.Text>
                  {winner && (
                    <Space size={4}>
                      <TrophyOutlined style={{ color: '#f59e0b' }} />
                      {finalWinner && <Tag color="gold">冠军</Tag>}
                    </Space>
                  )}
                </div>
                <Typography.Text type="secondary" style={{ display: 'block', marginTop: 4, fontSize: 12 }}>
                  {affiliation(side)}
                </Typography.Text>
              </>
            ) : (
              <>
                <Typography.Text type="secondary" strong>
                  {placeholder}
                </Typography.Text>
                <Typography.Text type="secondary" style={{ display: 'block', marginTop: 4, fontSize: 12 }}>
                  待定
                </Typography.Text>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

function BracketRenderer({ data }: { data?: BracketData | null }) {
  if (!data) return <Empty description="请选择单项查看对阵" />;
  if (!data.rounds.length && !data.groups.length) return <Empty description="暂无抽签结果，请先点击抽签" />;

  if (data.groups.length) {
    const format = data.event?.format;
    const alertMeta =
      format === 'ROUND_ROBIN'
        ? {
            message: '单循环排名赛已生成',
            description:
              '所有选手在同一循环组内两两对战，按胜场 → 净小分直接排出全部名次，无需再生成淘汰赛。',
          }
        : format === 'GROUP_PLUS_PLAYOFF'
          ? {
              message: '小组循环已生成（含交叉排位赛）',
              description:
                '两组组内循环全部结束后，系统会自动按各组名次生成交叉排位赛（A 组第 k 名 vs B 组第 k 名），逐对决出每个名次。',
            }
          : {
              message: '小组循环已生成',
              description:
                '当前阶段显示小组分组与组内循环赛。小组赛完成后，可按出线名额继续生成淘汰赛对阵。',
            };
    return (
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Alert type="info" showIcon message={alertMeta.message} description={alertMeta.description} />
        <Row gutter={[16, 16]}>
          {data.groups.map((group) => (
            <Col xs={24} lg={12} key={group.name}>
              <section style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 12 }}>
                <Typography.Title level={5} style={{ marginTop: 0 }}>{group.name} 组</Typography.Title>
                <Table
                  rowKey="id"
                  dataSource={group.registrations}
                  pagination={false}
                  size="small"
                  columns={[
                    { title: '报名', render: (_, row: Registration) => sideName(row) },
                    { title: '单位', render: (_, row: Registration) => affiliation(row) },
                    {
                      title: '种子',
                      render: (_, row: Registration) =>
                        row.isSeed ? <Tag color="gold">{row.seedRank}号种子</Tag> : <Typography.Text type="secondary">非种子</Typography.Text>,
                    },
                  ]}
                />
                <Typography.Text type="secondary" style={{ display: 'block', marginTop: 12 }}>
                  组内循环场次：{group.matches.length}
                </Typography.Text>
              </section>
            </Col>
          ))}
        </Row>
      </Space>
    );
  }

  return <KnockoutBracket data={toKnockoutBracketData(data)} />;
}

export default function DrawsPage() {
  const { data: session } = useSession();
  const token = session?.user?.accessToken as string | undefined;
  const userRole = session?.user?.role;
  const userId = session?.user?.id;
  const isSuperAdmin = userRole === 'SUPER_ADMIN';
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [selectedTournamentId, setSelectedTournamentId] = useState('');
  const [selectedEventId, setSelectedEventId] = useState('');
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [bracket, setBracket] = useState<BracketData | null>(null);
  const [loading, setLoading] = useState(false);
  const [registrationOpen, setRegistrationOpen] = useState(false);
  const [registrationForm] = Form.useForm();
  const [swapPosA, setSwapPosA] = useState<number | undefined>(undefined);
  const [swapPosB, setSwapPosB] = useState<number | undefined>(undefined);
  const [redrawRequests, setRedrawRequests] = useState<RedrawRequestItem[]>([]);
  const [requestOpen, setRequestOpen] = useState(false);
  const [requestForm] = Form.useForm();
  const [rejectingRequest, setRejectingRequest] = useState<RedrawRequestItem | null>(null);
  const [rejectForm] = Form.useForm();
  const [secondStageForm] = Form.useForm();

  const selectedEvent = useMemo(
    () => events.find((event) => event.id === selectedEventId),
    [events, selectedEventId],
  );

  const visibleRegistrations = useMemo(() => {
    return [...(selectedEventId ? registrations : [])].sort((a, b) => {
      if (a.isSeed !== b.isSeed) return a.isSeed ? -1 : 1;
      if (a.isSeed && b.isSeed) return (a.seedRank ?? 999) - (b.seedRank ?? 999);
      return String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? ''));
    });
  }, [registrations, selectedEventId]);
  const visibleBracket = selectedEventId ? bracket : null;
  const isSecondStageFormat = selectedEvent?.format === 'SINGLE_ELIMINATION_PLUS_GROUP_RANKING';
  const unplacedRegistrations = useMemo(() => {
    if (!visibleBracket?.rounds.length) return [];
    const placedIds = new Set(
      visibleBracket.rounds.flatMap((round) =>
        round.matches.flatMap((match) => [match.side1?.id, match.side2?.id].filter(Boolean) as string[]),
      ),
    );
    return visibleRegistrations.filter((registration) => !placedIds.has(registration.id));
  }, [visibleBracket, visibleRegistrations]);
  const slotOptions = useMemo(() => {
    if (!visibleBracket?.rounds.length) return [];
    const round1 = visibleBracket.rounds[0];
    return round1.matches.flatMap((match, i) => [
      {
        value: i * 2 + 1,
        label: `#${i * 2 + 1}  ${match.side1 ? sideName(match.side1) : '轮空'}`,
      },
      {
        value: i * 2 + 2,
        label: `#${i * 2 + 2}  ${match.side2 ? sideName(match.side2) : '轮空'}`,
      },
    ]);
  }, [visibleBracket]);
  const pendingRedrawRequest = useMemo(
    () =>
      redrawRequests.find(
        (item) => item.eventItemId === selectedEventId && item.status === 'PENDING',
      ) ?? null,
    [redrawRequests, selectedEventId],
  );

  const canShowSwapControls = Boolean(
    bracket?.currentDraw &&
      !selectedEvent?.drawPublished &&
      isSingleElimination(selectedEvent) &&
      slotOptions.length > 0 &&
      bracket.currentDraw.status === 'DRAWN',
  );

  async function loadEvents(tournamentId: string) {
    if (!token || !tournamentId) return;
    const data = await apiFetch<EventItem[]>(`/events?tournamentId=${tournamentId}`, { token });
    setEvents(data);
    setSelectedEventId(data[0]?.id ?? '');
  }

  async function loadRedrawRequests(eventId: string) {
    if (!token || !eventId) {
      setRedrawRequests([]);
      return;
    }
    try {
      const data = await apiFetch<RedrawRequestItem[]>(
        `/draw/redraw-requests?eventId=${eventId}&status=PENDING`,
        { token },
      );
      setRedrawRequests(data);
    } catch (error) {
      setRedrawRequests([]);
      console.error(error);
    }
  }

  function updateEventDrawState(
    eventId: string,
    nextState: Partial<Pick<EventItem, 'drawLocked' | 'drawPublished' | 'drawGeneratedAt'>>,
  ) {
    setEvents((prev) =>
      prev.map((event) =>
        event.id === eventId
          ? {
              ...event,
              ...nextState,
            }
          : event,
      ),
    );
  }

  async function refreshDraw() {
    if (!token || !selectedEventId) return;
    const [registrationData, bracketData] = await Promise.all([
      apiFetch<Registration[]>(`/events/${selectedEventId}/registrations`, { token }),
      apiFetch<BracketData>(`/events/${selectedEventId}/bracket`, { token }),
    ]);
    setRegistrations(registrationData);
    setBracket(bracketData);
    loadRedrawRequests(selectedEventId);
    updateEventDrawState(selectedEventId, {
      drawLocked: bracketData.event.drawLocked,
      drawPublished: bracketData.event.drawPublished,
      drawGeneratedAt: bracketData.event.drawGeneratedAt,
    });
  }

  useEffect(() => {
    if (!token) return;
    let alive = true;
    async function loadBase() {
      const [tournamentData, playerData] = await Promise.all([
        apiFetch<Tournament[]>('/tournaments', { token }),
        apiFetch<Player[]>('/players', { token }),
      ]);
      if (!alive) return;
      setTournaments(tournamentData);
      setPlayers(playerData);
      if (tournamentData[0]) setSelectedTournamentId(tournamentData[0].id);
    }
    loadBase().catch((error) => message.error(error instanceof Error ? error.message : '加载基础数据失败'));
    return () => {
      alive = false;
    };
  }, [token]);

  useEffect(() => {
    if (!token || !selectedTournamentId) return;
    loadEvents(selectedTournamentId).catch((error) => message.error(error instanceof Error ? error.message : '加载单项失败'));
  }, [token, selectedTournamentId]);

  useEffect(() => {
    if (!token || !selectedEventId) return;
    let alive = true;
    async function loadDraw() {
      setLoading(true);
      try {
        const [registrationData, bracketData] = await Promise.all([
          apiFetch<Registration[]>(`/events/${selectedEventId}/registrations`, { token }),
          apiFetch<BracketData>(`/events/${selectedEventId}/bracket`, { token }),
        ]);
        if (!alive) return;
        setRegistrations(registrationData);
        setBracket(bracketData);
        setEvents((prev) =>
          prev.map((event) =>
            event.id === selectedEventId
              ? {
                  ...event,
                  drawLocked: bracketData.event.drawLocked,
                  drawPublished: bracketData.event.drawPublished,
                  drawGeneratedAt: bracketData.event.drawGeneratedAt,
                }
              : event,
          ),
        );
      } finally {
        if (alive) setLoading(false);
      }
    }
    loadDraw().catch((error) => message.error(error instanceof Error ? error.message : '加载抽签数据失败'));
    loadRedrawRequests(selectedEventId);
    return () => {
      alive = false;
    };
  }, [token, selectedEventId]);

  useEffect(() => {
    const secondStage = visibleBracket?.secondStage;
    if (!secondStage) {
      secondStageForm.resetFields();
      secondStageForm.setFieldsValue({ rankingMode: 'TOP_8' });
      return;
    }
    secondStageForm.setFieldsValue({
      rankingMode: secondStage.rankingMode ?? 'TOP_8',
      slots: Object.fromEntries(
        (secondStage.slots ?? []).map((slot) => [slot.slot, slot.playerId ?? undefined]),
      ),
    });
  }, [secondStageForm, visibleBracket?.secondStage]);

  async function handleAddRegistration() {
    const values = await registrationForm.validateFields();
    try {
      await apiFetch(`/events/${selectedEventId}/registrations`, {
        method: 'POST',
        token,
        body: JSON.stringify(values),
      });
      message.success('报名已加入单项');
      setRegistrationOpen(false);
      registrationForm.resetFields();
      refreshDraw();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '添加报名失败');
    }
  }

  async function handleDeleteRegistration(id: string) {
    try {
      await apiFetch(`/registrations/${id}`, { method: 'DELETE', token });
      message.success('已移除报名');
      refreshDraw();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '移除失败');
    }
  }

  async function handleDraw(force = false) {
    if (!selectedEventId) return;
    setLoading(true);
    try {
      await apiFetch(force ? `/events/${selectedEventId}/draw/redraw` : `/events/${selectedEventId}/draw`, {
        method: 'POST',
        token,
        body: JSON.stringify(force ? { confirm: true } : { force }),
      });
      updateEventDrawState(selectedEventId, {
        drawLocked: false,
        drawPublished: false,
        drawGeneratedAt: new Date().toISOString(),
      });
      await refreshDraw();
      setSwapPosA(undefined);
      setSwapPosB(undefined);
      message.success(force ? '已重新抽签，可调整签位后发布' : '抽签完成，可调整签位后点击发布');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '抽签失败');
    } finally {
      setLoading(false);
    }
  }

  async function togglePublish(publish: boolean) {
    if (!token || !selectedEventId || !bracket?.currentDraw) return;
    try {
      await apiFetch(`/events/${selectedEventId}/draw/${publish ? 'publish' : 'unpublish'}`, {
        method: 'POST',
        token,
        body: JSON.stringify({ drawId: bracket.currentDraw.id }),
      });
      updateEventDrawState(selectedEventId, {
        drawLocked: publish,
        drawPublished: publish,
      });
      await refreshDraw();
      message.success(publish ? '对阵图已发布，公众可查看' : '已取消发布，对阵图不再公开显示');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '操作失败');
    }
  }

  async function submitRedrawRequest() {
    if (!token || !selectedEventId) return;
    const values = await requestForm.validateFields();
    try {
      await apiFetch(`/events/${selectedEventId}/draw/redraw-request`, {
        method: 'POST',
        token,
        body: JSON.stringify({ reason: values.reason ?? '' }),
      });
      message.success('已提交重抽申请，等待总管理员审批');
      setRequestOpen(false);
      requestForm.resetFields();
      loadRedrawRequests(selectedEventId);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '申请提交失败');
    }
  }

  async function approveRedrawRequest(request: RedrawRequestItem) {
    if (!token) return;
    try {
      await apiFetch(`/draw/redraw-requests/${request.id}/approve`, {
        method: 'POST',
        token,
      });
      updateEventDrawState(request.eventItemId, {
        drawLocked: false,
        drawPublished: false,
        drawGeneratedAt: new Date().toISOString(),
      });
      message.success('已同意申请，重抽已完成（未发布）');
      await refreshDraw();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '审批失败');
    }
  }

  async function submitRejectRequest() {
    if (!token || !rejectingRequest) return;
    const values = await rejectForm.validateFields();
    try {
      await apiFetch(`/draw/redraw-requests/${rejectingRequest.id}/reject`, {
        method: 'POST',
        token,
        body: JSON.stringify({ reason: values.reason ?? '' }),
      });
      message.success('已拒绝该申请');
      setRejectingRequest(null);
      rejectForm.resetFields();
      loadRedrawRequests(selectedEventId);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '操作失败');
    }
  }

  async function cancelRedrawRequest(request: RedrawRequestItem) {
    if (!token) return;
    try {
      await apiFetch(`/draw/redraw-requests/${request.id}/cancel`, {
        method: 'POST',
        token,
      });
      message.success('已撤回申请');
      loadRedrawRequests(selectedEventId);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '撤回失败');
    }
  }

  async function handleSwap() {
    if (!token || !selectedEventId || !bracket?.currentDraw || !swapPosA || !swapPosB) return;
    try {
      await apiFetch(`/events/${selectedEventId}/draw/swap`, {
        method: 'POST',
        token,
        body: JSON.stringify({ drawId: bracket.currentDraw.id, positionA: swapPosA, positionB: swapPosB }),
      });
      setSwapPosA(undefined);
      setSwapPosB(undefined);
      await refreshDraw();
      message.success('签位已交换');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '签位交换失败');
    }
  }

  async function handleConfirmSecondStage() {
    if (!token || !selectedEventId) return;
    const values = await secondStageForm.validateFields();
    const slots = SECOND_STAGE_SLOT_CODES.map((slot) => {
      const value = values.slots?.[slot];
      // 留空或选“轮空”哨兵 → 该签位无选手（轮空）。
      return { slot, entrantId: value && value !== SECOND_STAGE_BYE ? value : null };
    });
    try {
      await apiFetch(`/events/${selectedEventId}/second-stage/confirm`, {
        method: 'POST',
        token,
        body: JSON.stringify({
          rankingMode: values.rankingMode ?? 'TOP_8',
          slots,
        }),
      });
      await refreshDraw();
      message.success('第二阶段已确认生成，前台对阵表会同步显示');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '第二阶段生成失败');
    }
  }

  const playerOptions = players.map((player) => ({
    value: player.id,
    label: `${player.name} · ${player.gender === 'MALE' ? '男' : '女'} · ${player.affiliation}`,
  }));

  const registrationColumns = [
    {
      title: '报名',
      render: (_: unknown, row: Registration) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{sideName(row)}</Typography.Text>
          <Typography.Text type="secondary">{affiliation(row)}</Typography.Text>
        </Space>
      ),
    },
    {
      title: '种子',
      width: 110,
      render: (_: unknown, row: Registration) =>
        row.isSeed ? <Tag color="gold">{row.seedRank}号种子</Tag> : <Typography.Text type="secondary">非种子</Typography.Text>,
    },
    ...(!isSingleElimination(selectedEvent)
      ? [
          {
            title: '小组',
            width: 90,
            render: (_: unknown, row: Registration) => (row.groupName ? <Tag color="blue">{row.groupName} 组</Tag> : '-'),
          },
        ]
      : []),
    {
      title: '操作',
      width: 90,
      render: (_: unknown, row: Registration) => (
        <Popconfirm title="确认移除该报名？" onConfirm={() => handleDeleteRegistration(row.id)}>
          <Button size="small" danger icon={<DeleteOutlined />} disabled={selectedEvent?.drawLocked}>
            移除
          </Button>
        </Popconfirm>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>抽签编排</Typography.Title>
          <Typography.Text type="secondary">抽签后可调整签位，确认无误后点击发布，公众才能看到对阵图。</Typography.Text>
        </div>
        <Space wrap>
          <Button icon={<ReloadOutlined />} onClick={refreshDraw} disabled={!selectedEventId}>
            刷新
          </Button>
          {bracket?.currentDraw && !selectedEvent?.drawPublished && (
            <Button
              type="primary"
              icon={<CheckCircleOutlined />}
              onClick={() => togglePublish(true)}
              disabled={!visibleBracket?.rounds.length && !visibleBracket?.groups.length}
            >
              发布对阵
            </Button>
          )}
          {bracket?.currentDraw && selectedEvent?.drawPublished && (
            <Popconfirm title="取消发布后公众将看不到对阵，确认继续？" onConfirm={() => togglePublish(false)}>
              <Button icon={<EyeInvisibleOutlined />}>取消发布</Button>
            </Popconfirm>
          )}
          {bracket?.currentDraw ? (
            selectedEvent?.drawPublished && !isSuperAdmin ? (
              <Button
                icon={<FileDoneOutlined />}
                onClick={() => setRequestOpen(true)}
                disabled={!selectedEventId || registrations.length < 2 || Boolean(pendingRedrawRequest)}
              >
                {pendingRedrawRequest ? '已提交申请，等待审批' : '申请重新抽签'}
              </Button>
            ) : (
              <Popconfirm
                title={
                  selectedEvent?.drawPublished
                    ? '对阵已发布，重抽会清空所有比赛结果并取消发布，确认继续？'
                    : '重新抽签会覆盖当前对阵，确认继续？'
                }
                onConfirm={() => handleDraw(true)}
              >
                <Button danger icon={<BranchesOutlined />} disabled={!selectedEventId || registrations.length < 2}>
                  重新抽签
                </Button>
              </Popconfirm>
            )
          ) : (
            <Button type="primary" icon={<BranchesOutlined />} onClick={() => handleDraw(false)} disabled={!selectedEventId || registrations.length < 2}>
              抽签
            </Button>
          )}
        </Space>
      </div>

      <section style={{ marginBottom: 16, border: '1px solid #f0f0f0', borderRadius: 8, padding: 16, background: '#fff' }}>
        <Row gutter={[16, 16]} align="middle">
          <Col xs={24} md={10}>
            <Select
              style={{ width: '100%' }}
              placeholder="选择赛事"
              value={selectedTournamentId || undefined}
              onChange={setSelectedTournamentId}
              options={tournaments.map((t) => ({ value: t.id, label: t.name }))}
            />
          </Col>
          <Col xs={24} md={10}>
            <Select
              style={{ width: '100%' }}
              placeholder="选择单项"
              value={selectedEventId || undefined}
              onChange={setSelectedEventId}
              options={events.map((event) => ({
                value: event.id,
                label: `${EVENT_TYPE_LABELS[event.type] || event.type} · ${FORMAT_LABELS[event.format] || event.format}`,
              }))}
            />
          </Col>
          <Col xs={24} md={4}>
            {!bracket?.currentDraw ? (
              <Tag color="default">未抽签</Tag>
            ) : selectedEvent?.drawPublished ? (
              <Tag color="green">已发布</Tag>
            ) : (
              <Tag color="orange">未发布</Tag>
            )}
          </Col>
        </Row>
      </section>

      {pendingRedrawRequest && (
        <section
          style={{
            marginBottom: 16,
            border: '1px solid #faad14',
            borderRadius: 8,
            padding: 16,
            background: '#fffbe6',
          }}
        >
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            <Space wrap>
              <FileDoneOutlined style={{ color: '#d48806' }} />
              <Typography.Text strong style={{ color: '#d48806' }}>
                {isSuperAdmin ? '待审批的重抽申请' : '我的重抽申请'}
              </Typography.Text>
              <Tag color="orange">PENDING</Tag>
            </Space>
            <Typography.Text>
              申请人：{pendingRedrawRequest.requesterNameSnapshot ?? pendingRedrawRequest.requesterId}　·　提交时间：
              {new Date(pendingRedrawRequest.createdAt).toLocaleString()}
            </Typography.Text>
            <Typography.Text type="secondary">
              理由：{pendingRedrawRequest.reason || '（未填写）'}
            </Typography.Text>
            <Space wrap>
              {isSuperAdmin && (
                <>
                  <Popconfirm
                    title="同意将立即重新抽签并清空所有已产生的比赛结果（不会自动发布），确认继续？"
                    onConfirm={() => approveRedrawRequest(pendingRedrawRequest)}
                  >
                    <Button type="primary" icon={<CheckCircleOutlined />}>
                      同意并重抽
                    </Button>
                  </Popconfirm>
                  <Button
                    danger
                    icon={<CloseCircleOutlined />}
                    onClick={() => setRejectingRequest(pendingRedrawRequest)}
                  >
                    拒绝
                  </Button>
                </>
              )}
              {!isSuperAdmin && pendingRedrawRequest.requesterId === userId && (
                <Popconfirm
                  title="确认撤回该申请？"
                  onConfirm={() => cancelRedrawRequest(pendingRedrawRequest)}
                >
                  <Button>撤回申请</Button>
                </Popconfirm>
              )}
            </Space>
          </Space>
        </section>
      )}

      <Spin spinning={loading}>
        <Row gutter={[16, 16]}>
          <Col xs={24} xl={8}>
            <section style={{ border: '1px solid #f0f0f0', borderRadius: 8, padding: 16, background: '#fff' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <Typography.Title level={5} style={{ margin: 0 }}>报名名单</Typography.Title>
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  disabled={!selectedEventId || selectedEvent?.drawLocked}
                  onClick={() => setRegistrationOpen(true)}
                >
                  添加报名
                </Button>
              </div>
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 12 }}
                message={selectedEvent ? `${EVENT_TYPE_LABELS[selectedEvent.type]} · ${FORMAT_LABELS[selectedEvent.format]}` : '请选择单项'}
              />
              {!selectedEvent?.drawLocked && unplacedRegistrations.length > 0 && (
                <Alert
                  type="warning"
                  showIcon
                  style={{ marginBottom: 12 }}
                  message={`未排位选手：${unplacedRegistrations.map(sideName).join('、')}（重新抽签后才会进入对阵）`}
                />
              )}
              <Table
                rowKey="id"
                size="small"
                columns={registrationColumns}
                dataSource={visibleRegistrations}
                pagination={{ pageSize: 8 }}
              />
            </section>
          </Col>
          <Col xs={24} xl={16}>
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              {canShowSwapControls && (
                <section style={{ border: '1px solid #faad14', borderRadius: 8, padding: 16, background: '#fffbe6' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                    <SwapOutlined style={{ color: '#d48806' }} />
                    <Typography.Text strong style={{ color: '#d48806' }}>签位调整</Typography.Text>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      发布前可交换任意两个签位的选手
                    </Typography.Text>
                  </div>
                  <Space wrap>
                    <Select
                      value={swapPosA}
                      onChange={setSwapPosA}
                      placeholder="选择签位 A"
                      style={{ width: 220 }}
                      options={slotOptions.filter((opt) => opt.value !== swapPosB)}
                    />
                    <Select
                      value={swapPosB}
                      onChange={setSwapPosB}
                      placeholder="选择签位 B"
                      style={{ width: 220 }}
                      options={slotOptions.filter((opt) => opt.value !== swapPosA)}
                    />
                    <Popconfirm
                      title={`确认交换签位 #${swapPosA} 与 #${swapPosB} 的选手？`}
                      onConfirm={handleSwap}
                      disabled={!swapPosA || !swapPosB}
                    >
                      <Button
                        type="primary"
                        icon={<SwapOutlined />}
                        disabled={!swapPosA || !swapPosB}
                      >
                        交换
                      </Button>
                    </Popconfirm>
                    {(swapPosA || swapPosB) && (
                      <Button onClick={() => { setSwapPosA(undefined); setSwapPosB(undefined); }}>清除</Button>
                    )}
                  </Space>
                </section>
              )}
              <section style={{ border: '1px solid #f0f0f0', borderRadius: 8, padding: 16, background: '#fff' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 12, flexWrap: 'wrap' }}>
                  <Typography.Title level={5} style={{ margin: 0 }}>对阵图</Typography.Title>
                  <Typography.Text type="secondary">
                    {selectedEvent?.drawGeneratedAt
                      ? `生成时间：${new Date(selectedEvent.drawGeneratedAt).toLocaleString()}`
                      : '尚未生成'}
                  </Typography.Text>
                </div>
                <BracketRenderer data={visibleBracket} />
              </section>
              {isSecondStageFormat && (
                <section style={{ border: '1px solid #d9f7be', borderRadius: 8, padding: 16, background: '#fff' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 12, flexWrap: 'wrap' }}>
                    <div>
                      <Typography.Title level={5} style={{ margin: 0 }}>第二阶段：小组赛排位赛</Typography.Title>
                      <Typography.Text type="secondary">分组方式：裁判手动指定；签位来源：组委会手动安排。</Typography.Text>
                    </div>
                    <Button type="primary" icon={<TrophyOutlined />} onClick={handleConfirmSecondStage} disabled={!selectedEventId || visibleRegistrations.length < 8}>
                      确认生成第二阶段
                    </Button>
                  </div>
                  <Alert
                    type="info"
                    showIcon
                    style={{ marginBottom: 12 }}
                    message="请手动指定 A-H 签位（可留空＝轮空）"
                    description="确认后会生成 A vs B、C vs D、E vs F、G vs H，并按 TOP_6 / TOP_8 自动准备后续排位赛。签位可留空或选“轮空”（至少需 2 名选手），轮空位的对手不战自动晋级。重新抽签会清空已指定的 A-H 签位，需重新指定。"
                  />
                  <Form form={secondStageForm} layout="vertical" initialValues={{ rankingMode: 'TOP_8' }}>
                    <Form.Item name="rankingMode" label="排名范围" rules={[{ required: true, message: '请选择排名范围' }]}>
                      <Select
                        options={[
                          { value: 'TOP_8', label: '取前8名' },
                          { value: 'TOP_6', label: '取前6名' },
                        ]}
                      />
                    </Form.Item>
                    <Row gutter={[12, 0]}>
                      {SECOND_STAGE_SLOT_CODES.map((slot) => (
                        <Col xs={24} sm={12} md={6} key={slot}>
                          <Form.Item
                            name={['slots', slot]}
                            label={`${slot} 签位`}
                          >
                            <Select
                              showSearch
                              allowClear
                              placeholder="留空 = 轮空"
                              optionFilterProp="label"
                              options={[
                                { value: SECOND_STAGE_BYE, label: '轮空（空位，对手不战晋级）' },
                                ...visibleRegistrations.map((registration) => ({
                                  value: registration.id,
                                  label: sideName(registration),
                                })),
                              ]}
                            />
                          </Form.Item>
                        </Col>
                      ))}
                    </Row>
                  </Form>
                  {visibleBracket?.secondStage ? (
                    <div style={{ marginTop: 8 }}>
                      <SecondStageBracket data={visibleBracket.secondStage} />
                      <Alert
                        type="success"
                        showIcon
                        style={{ marginTop: 12 }}
                        message="第二阶段对阵已自动生成"
                        description="A-H 签位确认后，系统会生成正式比赛；后续比分由赛程/裁判记分同步，胜负关系自动推进，不需要在这里手动录入。"
                      />
                    </div>
                  ) : null}
                </section>
              )}
            </Space>
          </Col>
        </Row>
      </Spin>

      <Modal
        title="添加单项报名"
        open={registrationOpen}
        onOk={handleAddRegistration}
        onCancel={() => setRegistrationOpen(false)}
        okText="保存"
        cancelText="取消"
      >
        <Form form={registrationForm} layout="vertical" style={{ marginTop: 16 }} initialValues={{ isSeed: false }}>
          <Form.Item name="player1Id" label={isDoublesEvent(selectedEvent?.type) ? '选手 1' : '选手'} rules={[{ required: true, message: '请选择选手' }]}>
            <Select showSearch optionFilterProp="label" options={playerOptions} />
          </Form.Item>
          {isDoublesEvent(selectedEvent?.type) && (
            <Form.Item name="player2Id" label="选手 2" rules={[{ required: true, message: '请选择搭档' }]}>
              <Select showSearch optionFilterProp="label" options={playerOptions} />
            </Form.Item>
          )}
          <Form.Item name="isSeed" label="是否种子" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item shouldUpdate noStyle>
            {({ getFieldValue }) =>
              getFieldValue('isSeed') ? (
                <Form.Item name="seedRank" label="种子顺位" rules={[{ required: true, message: '请输入种子顺位' }]}>
                  <InputNumber min={1} max={16} style={{ width: '100%' }} />
                </Form.Item>
              ) : null
            }
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="申请重新抽签"
        open={requestOpen}
        onOk={submitRedrawRequest}
        onCancel={() => {
          setRequestOpen(false);
          requestForm.resetFields();
        }}
        okText="提交申请"
        cancelText="取消"
      >
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="对阵已发布"
          description="申请通过后，总管理员会清空当前所有比赛结果并重新生成对阵（不会自动重新发布）。"
        />
        <Form form={requestForm} layout="vertical">
          <Form.Item
            name="reason"
            label="申请理由"
            rules={[{ required: true, message: '请填写申请理由，便于总管理员审批' }]}
          >
            <Input.TextArea rows={4} maxLength={500} showCount placeholder="例如：发现报名信息有误 / 选手退赛需要重新分签等" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="拒绝重抽申请"
        open={Boolean(rejectingRequest)}
        onOk={submitRejectRequest}
        onCancel={() => {
          setRejectingRequest(null);
          rejectForm.resetFields();
        }}
        okText="确认拒绝"
        cancelText="取消"
      >
        <Form form={rejectForm} layout="vertical">
          <Form.Item name="reason" label="拒绝原因（可选）">
            <Input.TextArea rows={4} maxLength={500} showCount placeholder="向申请人说明拒绝原因" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
