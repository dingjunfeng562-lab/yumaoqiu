'use client';
import { useCurrentAccess } from '@/lib/use-current-role';

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
  Radio,
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
import { DrawSwapModal } from '@/components/DrawSwapModal';
import TeamCompetitionGroups from '@/components/TeamCompetitionGroups';
import ClearResultsButton from '@/components/ClearResultsButton';
import { UnpaidNotice } from '@/components/payments/UnpaidNotice';
import { DrawStaleNotice } from '@/components/admin/DrawStaleNotice';

type TeamCompetitionOption = {
  id: string;
  name: string;
  format?: string;
  groupCount?: number | null;
  advancePerGroup?: number | null;
  _count?: { teams: number; teamMatches: number };
};
type TeamCompetitionTeam = { id: string; name: string };

const EVENT_TYPE_LABELS: Record<string, string> = {
  MENS_SINGLES: '男子单打',
  WOMENS_SINGLES: '女子单打',
  MENS_DOUBLES: '男子双打',
  WOMENS_DOUBLES: '女子双打',
  MIXED_DOUBLES: '混合双打',
};

const FORMAT_LABELS: Record<string, string> = {
  GROUP_PLUS_KNOCKOUT_STD: '小组循环 + 淘汰(标准2023)',
  SINGLE_ELIMINATION: '单淘汰制',
  GROUP_PLUS_KNOCKOUT: '小组赛 + 淘汰赛',
  ROUND_ROBIN: '单循环排名赛',
  GROUP_PLUS_PLAYOFF: '小组循环 + 交叉排位',
  SINGLE_ELIMINATION_PLUS_GROUP_RANKING: '单淘汰 + 小组赛排位赛',
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
  groupLabel?: string | null;
  /** 混编：主项目带混编名 mixLabel；并入的单项带 mixHostId 和所在混编名 mixHostLabel，要到主项目抽签。 */
  mixLabel?: string | null;
  mixHostId?: string | null;
  mixHostLabel?: string | null;
  groupSize?: number | null;
  groupCount?: number | null;
  qualifiersPerGroup?: number | null;
  /** 小组编号：A、B、C（LETTER，默认）或 1、2、3（NUMBER）。 */
  groupNaming?: GroupNaming;
  drawLocked: boolean;
  drawPublished: boolean;
  drawGeneratedAt?: string | null;
}

/** 选择框里的单项名：混编主项目用混编名，其它「组别 · 项目」。 */
function drawEventLabel(event: EventItem) {
  if (event.mixLabel) return event.mixLabel;
  const type = EVENT_TYPE_LABELS[event.type] || event.type;
  return event.groupLabel ? `${event.groupLabel} · ${type}` : type;
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
  teamName?: string | null;
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

interface GroupPlanView {
  entrantCount: number;
  groupCount: number;
  sizes: number[];
  manualGroupCount: boolean;
  groupSize: number | null;
  qualifiersPerGroup: number;
  qualifiersTotal: number;
  secondStage: 'AH' | 'AUTO' | 'PLAYOFF' | 'MANUAL';
  errors: string[];
}

// 当前签表与「按现在的分组设置重新抽签」不一致时后端给出的对比（一致或不宜提示时为 null）。
interface GroupPlanDriftView {
  currentGroupCount: number;
  currentSizes: number[];
  planGroupCount: number;
  planSizes: number[];
  settingsChangedAfterDraw: boolean;
}

interface BracketData {
  event: EventItem;
  currentDraw?: DrawBracket | null;
  registrations: Registration[];
  rounds: RoundItem[];
  groups: GroupItem[];
  groupPlan?: GroupPlanView | null;
  groupPlanDrift?: GroupPlanDriftView | null;
  knockoutSkeleton?: KnockoutBracketData['knockoutSkeleton'];
  secondStage?: SecondStageData | null;
  // 标准2023 出线超过 8 人：小组赛结束后自动生成淘汰赛，不走 A-H 第二阶段（此时 secondStage 为 null）。
  autoKnockout?: { qualifiers: number } | null;
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

function groupMatchCount(sizes: number[]) {
  return sizes.reduce((sum, size) => sum + (size * (size - 1)) / 2, 0);
}

function groupPlanSummary(plan: GroupPlanView) {
  const mode = plan.manualGroupCount
    ? `手动 ${plan.groupCount} 组`
    : `每组 ${plan.groupSize ?? 4} 人（自动算组数）`;
  if (plan.secondStage === 'PLAYOFF') {
    return `${mode} · 按当前报名的 ${plan.entrantCount} 人将分 ${plan.groupCount} 组（${plan.sizes.join('+')}）；小组赛结束后按 A/B 组名次自动生成交叉排位赛。`;
  }
  const stage2Label: Record<GroupPlanView['secondStage'], string> = {
    AUTO: '小组赛结束后自动生成淘汰赛',
    AH: '小组赛结束后在 A–H 签位编排第二阶段',
    PLAYOFF: '',
    MANUAL: '小组赛结束后按出线名额人工生成淘汰赛',
  };
  return `${mode} · 每组出线 ${plan.qualifiersPerGroup} 人 → 按当前报名的 ${plan.entrantCount} 人将分 ${plan.groupCount} 组（${plan.sizes.join('+')}），出线 ${plan.qualifiersTotal} 人；${stage2Label[plan.secondStage]}。`;
}

// 可以设置「每组人数 / 手动小组数量」的赛制（与后端 usesGroupConfig 一致）。
const GROUP_SETTING_FORMATS = new Set(['GROUP_PLUS_KNOCKOUT', 'GROUP_PLUS_KNOCKOUT_STD']);
// 抽签时会分小组、可以选小组编号的赛制（后端 drawFormatForEvent 不是单淘汰的几种）。
const GROUP_NAMING_FORMATS = new Set(['GROUP_PLUS_KNOCKOUT', 'GROUP_PLUS_KNOCKOUT_STD', 'ROUND_ROBIN', 'GROUP_PLUS_PLAYOFF']);

type GroupNaming = 'LETTER' | 'NUMBER';
const GROUP_NAMING_TEXT: Record<GroupNaming, string> = { LETTER: 'A、B、C', NUMBER: '1、2、3' };

/**
 * 小组编号：A、B、C 或 1、2、3，点一下就保存。没抽签时下次抽签按它生成；
 * 已抽签时先确认，再把现有小组直接改名（A组→1组…），签表、对阵、比分、排程都不变。
 */
function GroupNamingSetting({
  event,
  hasDraw,
  token,
  onSaved,
}: {
  event: EventItem;
  hasDraw: boolean;
  token?: string;
  onSaved: (naming: GroupNaming) => Promise<void> | void;
}) {
  const current: GroupNaming = event.groupNaming ?? 'LETTER';
  const [pending, setPending] = useState<GroupNaming | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async (naming: GroupNaming) => {
    setSaving(true);
    try {
      const result = await apiFetch<{ renamedGroups: number }>(`/events/${event.id}/draw/group-naming`, {
        method: 'PATCH',
        token,
        body: JSON.stringify({ groupNaming: naming }),
      });
      message.success(
        result.renamedGroups
          ? `小组编号已改为 ${GROUP_NAMING_TEXT[naming]}，现有 ${result.renamedGroups} 个小组已改名`
          : `小组编号已设为 ${GROUP_NAMING_TEXT[naming]}`,
      );
      setPending(null);
      await onSaved(naming);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存小组编号失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Space wrap align="center" style={{ marginTop: 12 }}>
        <Typography.Text>小组编号</Typography.Text>
        <Radio.Group
          optionType="button"
          buttonStyle="solid"
          value={current}
          disabled={saving}
          options={[
            { value: 'LETTER', label: 'A B C' },
            { value: 'NUMBER', label: '1 2 3' },
          ]}
          onChange={(e) => {
            const next = e.target.value as GroupNaming;
            if (next === current) return;
            if (hasDraw) setPending(next);
            else void save(next);
          }}
        />
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {hasDraw ? '切换后现有小组直接改名，签表、对阵和比分不变' : '抽签时按这里的编号生成小组'}
        </Typography.Text>
      </Space>
      <Modal
        open={pending !== null}
        title="切换小组编号"
        okText="确定改名"
        cancelText="取消"
        confirmLoading={saving}
        onOk={() => (pending ? save(pending) : undefined)}
        onCancel={() => setPending(null)}
      >
        <p>当前签表的小组会直接改名为 {pending === 'NUMBER' ? '1组、2组、3组…' : 'A组、B组、C组…'}。</p>
        <p>
          签表、对阵、比分和场地排程都不变；{event.drawPublished ? '对阵已发布，前台会马上显示新编号；' : ''}
          已经导出或打印的秩序册需要重新导出。
        </p>
      </Modal>
    </>
  );
}

type GroupSettingsValues = {
  groupMode: 'auto' | 'manual';
  groupSize?: number | null;
  groupCount?: number | null;
  qualifiersPerGroup: number;
};

/**
 * 抽签编排页直接修改「当前选中单项」的分组设置，免得到单项管理页改错赛事。
 * 只保存设置、不动现有签表；保存后刷新分组预览，重新抽签才按新设置分组。
 */
function GroupSettingsPanel({
  event,
  token,
  onSaved,
  showGroupConfig,
  hasDraw,
  onNamingSaved,
}: {
  event: EventItem;
  token?: string;
  onSaved: (updated: EventItem) => Promise<void> | void;
  /** 「小组循环+淘汰」才有每组人数 / 小组数量 / 每组出线；单循环、两组交叉排位只有小组编号。 */
  showGroupConfig: boolean;
  hasDraw: boolean;
  onNamingSaved: (naming: GroupNaming) => Promise<void> | void;
}) {
  const [form] = Form.useForm<GroupSettingsValues>();
  const [saving, setSaving] = useState(false);
  const groupMode = Form.useWatch('groupMode', form) ?? 'auto';
  // 只在切换单项或保存后的值变化时回填表单，避免页面刷新打断正在输入的内容。
  const savedKey = `${event.id}:${event.groupSize ?? ''}:${event.groupCount ?? ''}:${event.qualifiersPerGroup ?? ''}:${showGroupConfig}`;

  useEffect(() => {
    // 单循环、两组交叉排位没有分组人数表单（只有小组编号），不回填，免得 antd 报「useForm 没连到 Form」。
    if (!showGroupConfig) return;
    form.setFieldsValue({
      groupMode: event.groupCount ? 'manual' : 'auto',
      groupSize: event.groupSize ?? null,
      groupCount: event.groupCount ?? null,
      qualifiersPerGroup: event.qualifiersPerGroup ?? 2,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey]);

  const save = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      const updated = await apiFetch<EventItem>(`/events/${event.id}/draw/group-settings`, {
        method: 'PATCH',
        token,
        body: JSON.stringify({
          groupSize: values.groupMode === 'manual' ? null : values.groupSize ?? null,
          groupCount: values.groupMode === 'manual' ? values.groupCount ?? null : null,
          qualifiersPerGroup: values.qualifiersPerGroup,
        }),
      });
      message.success(
        event.drawGeneratedAt ? '分组设置已保存，点「重新抽签」后按新设置分组' : '分组设置已保存',
      );
      await onSaved(updated);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存分组设置失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section style={{ marginBottom: 16, border: '1px solid #f0f0f0', borderRadius: 8, padding: 16, background: '#fff' }}>
      <Typography.Text strong>分组设置</Typography.Text>
      <Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
        只对当前选中的单项生效{showGroupConfig ? '；分组人数保存后不会改动已有签表，重新抽签才按新设置分组' : ''}。
      </Typography.Text>
      <div>
        <GroupNamingSetting event={event} hasDraw={hasDraw} token={token} onSaved={onNamingSaved} />
      </div>
      {showGroupConfig && (
        <Form form={form} layout="inline" style={{ marginTop: 12, rowGap: 12 }}>
          <Form.Item name="groupMode" label="分组方式">
            <Radio.Group
              optionType="button"
              buttonStyle="solid"
              options={[
                { value: 'auto', label: '按每组人数' },
                { value: 'manual', label: '手动指定组数' },
              ]}
            />
          </Form.Item>
          {groupMode === 'manual' ? (
            <Form.Item
              key="groupCount"
              name="groupCount"
              label="小组数量"
              rules={[{ required: true, message: '请输入小组数量' }]}
            >
              <InputNumber min={1} max={100} style={{ width: 110 }} />
            </Form.Item>
          ) : (
            <Form.Item key="groupSize" name="groupSize" label="每组人数">
              <InputNumber min={2} max={8} placeholder="默认 4" style={{ width: 110 }} />
            </Form.Item>
          )}
          <Form.Item
            name="qualifiersPerGroup"
            label="每组出线"
            rules={[{ required: true, message: '请输入每组出线数' }]}
          >
            <InputNumber min={1} max={8} style={{ width: 90 }} />
          </Form.Item>
          <Form.Item>
            <Button type="primary" onClick={save} loading={saving}>
              保存设置
            </Button>
          </Form.Item>
        </Form>
      )}
    </section>
  );
}

function seedMark(seed?: number | null) {
  if (!seed) return '';
  return CIRCLED_SEEDS[seed - 1] ?? `(${seed})`;
}

function sideName(registration?: Registration | null) {
  if (!registration) return '';
  const players = registration.player2
    ? `${registration.player1.name} / ${registration.player2.name}`
    : registration.player1.name;
  // 双打有队伍名时优先显示队伍名称，并在括号里附上队员名，便于按队伍名选择。
  const team = registration.teamName?.trim();
  const name = team ? `${team}（${players}）` : players;
  return `${name}${registration.isSeed ? ` ${seedMark(registration.seedRank)}` : ''}`;
}

function affiliation(registration?: Registration | null) {
  if (!registration) return '';
  // 双打两人同单位只写一次，与秩序册、对阵图导出 PNG 的写法一致。
  const units = [registration.player1.affiliation, registration.player2?.affiliation]
    .map((unit) => unit?.trim() ?? '')
    .filter(Boolean);
  return [...new Set(units)].join(' / ');
}

// 字母编号 A=1…Z=26、AA=27；数字编号按数值（2组 在 10组 前）。与后端 groupCodeSortValue 一致。
function groupNameSortValue(value: string) {
  const digits = /^\d+/.exec(value.trim())?.[0];
  if (digits) return Number(digits);
  const letters = /^[A-Z]+/.exec(value.trim().toUpperCase())?.[0];
  if (!letters) return Number.MAX_SAFE_INTEGER;
  return [...letters].reduce((sum, char) => sum * 26 + char.charCodeAt(0) - 64, 0);
}

function groupNameCompare(a: string, b: string) {
  return groupNameSortValue(a) - groupNameSortValue(b) || a.localeCompare(b, 'zh-CN', { numeric: true });
}

function groupMatchCompare(a: MatchItem, b: MatchItem) {
  return groupNameCompare(a.round, b.round) || a.matchNo - b.matchNo || a.id.localeCompare(b.id);
}

function isDoublesEvent(type?: string) {
  return ['MENS_DOUBLES', 'WOMENS_DOUBLES', 'MIXED_DOUBLES'].includes(type ?? '');
}

function isSingleElimination(event?: EventItem) {
  return ['SINGLE_ELIMINATION', 'SINGLE_ELIMINATION_PLUS_GROUP_RANKING'].includes(event?.format ?? '');
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
    knockoutSkeleton: data.knockoutSkeleton ?? null,
  };
}

// 标准2023 出线超过 8 人、淘汰赛尚未生成时：直接把预排骨架当作一张对阵图显示
//（签位为「X组第N名」），不再多出一张空的「0 个签位」卡片。
function toSkeletonBracketData(
  data: BracketData,
  skeleton: NonNullable<KnockoutBracketData['knockoutSkeleton']>,
): KnockoutBracketData {
  return {
    id: `${data.event.id}-skeleton`,
    tournamentId: data.event.tournamentId,
    title: `${EVENT_TYPE_LABELS[data.event.type] ?? data.event.type} 淘汰赛预览`,
    subtitle: `${skeleton.bracketSize} 签 · 出线 ${skeleton.participants.filter((item) => !item.isBye).length} 人 · 签位为「X组第N名」，小组赛全部结束后按此签表自动生成`,
    participants: skeleton.participants.map((item) => ({
      id: item.id,
      position: item.position,
      name: item.name,
      isBye: item.isBye,
    })),
    matches: skeleton.matches
      .filter((match) => match.round !== 'BRONZE')
      .map((match) => ({
        id: match.id,
        roundNo: match.roundNo,
        roundLabel: roundCn(match.round),
        matchNo: match.matchNo,
        status: match.status,
        side1Id: match.side1Id,
        side2Id: match.side2Id,
        winnerSide: match.winnerSide,
      })),
  };
}

function BracketRenderer({ data }: { data?: BracketData | null }) {
  if (!data) return <Empty description="请选择单项查看对阵" />;
  if (!data.rounds.length && !data.groups.length) return <Empty description="暂无抽签结果，请先点击抽签" />;

  if (data.groups.length) {
    const format = data.event?.format;
    const groups = [...data.groups]
      .sort((a, b) => groupNameCompare(a.name, b.name))
      .map((group) => ({
        ...group,
        matches: [...group.matches].sort(groupMatchCompare),
      }));
    const alertMeta =
      format === 'GROUP_PLUS_KNOCKOUT_STD'
        ? {
            message: '小组循环已生成（标准2023）',
            description:
              '蛇形分组 + 组内循环。小组赛全部完赛后，系统按官方名次（胜场→相互胜负→净胜局→净胜分）取各组出线选手：出线不超过 8 人进入下方 A-H 第二阶段；超过 8 人自动生成单淘汰对阵（轮空优先给小组第一，同组第一、第二分在上下半区，决赛前不会再相遇）。',
          }
        : format === 'ROUND_ROBIN'
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
          {groups.map((group) => (
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
        {format === 'GROUP_PLUS_KNOCKOUT_STD' && (data.rounds.length || data.knockoutSkeleton) ? (
          <>
            <Typography.Title level={5} style={{ margin: '8px 0 0' }}>
              {data.rounds.length ? '淘汰赛对阵' : '淘汰赛对阵（预览：小组赛全部结束后按此签表自动生成）'}
            </Typography.Title>
            <KnockoutBracket
              data={
                !data.rounds.length && data.knockoutSkeleton
                  ? toSkeletonBracketData(data, data.knockoutSkeleton)
                  : toKnockoutBracketData(data)
              }
            />
          </>
        ) : null}
      </Space>
    );
  }

  return <KnockoutBracket data={toKnockoutBracketData(data)} />;
}

export default function DrawsPage() {
  const { data: session } = useSession();
  const access = useCurrentAccess();
  const token = session?.user?.accessToken as string | undefined;
  const userRole = session?.user?.role;
  const userId = session?.user?.id;
  const isSuperAdmin = access.can('DRAWS');
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
  const [editingRegistration, setEditingRegistration] = useState<Registration | null>(null);
  const [seedForm] = Form.useForm();
  const [swapEventOpen, setSwapEventOpen] = useState(false);
  const [swapTeamOpen, setSwapTeamOpen] = useState(false);
  const [redrawRequests, setRedrawRequests] = useState<RedrawRequestItem[]>([]);
  const [requestOpen, setRequestOpen] = useState(false);
  const [requestForm] = Form.useForm();
  const [rejectingRequest, setRejectingRequest] = useState<RedrawRequestItem | null>(null);
  const [rejectForm] = Form.useForm();
  const [secondStageForm] = Form.useForm();
  const [teamCompetitions, setTeamCompetitions] = useState<TeamCompetitionOption[]>([]);
  const [selectedTeamCompetitionId, setSelectedTeamCompetitionId] = useState('');
  const [teamCompetitionTeams, setTeamCompetitionTeams] = useState<TeamCompetitionTeam[]>([]);

  const selectedTeamCompetition = useMemo(
    () => teamCompetitions.find((item) => item.id === selectedTeamCompetitionId),
    [teamCompetitions, selectedTeamCompetitionId],
  );

  const selectedEvent = useMemo(
    () => events.find((event) => event.id === selectedEventId),
    [events, selectedEventId],
  );
  // 并入混编的单项在主项目里抽签、设种子，这里只看名单（报名增删仍按原单项）。
  const isMixMember = Boolean(selectedEvent?.mixHostId);

  const visibleRegistrations = useMemo(() => {
    return [...(selectedEventId ? registrations : [])].sort((a, b) => {
      if (a.isSeed !== b.isSeed) return a.isSeed ? -1 : 1;
      if (a.isSeed && b.isSeed) return (a.seedRank ?? 999) - (b.seedRank ?? 999);
      return String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? ''));
    });
  }, [registrations, selectedEventId]);
  const visibleBracket = selectedEventId ? bracket : null;
  const isManualSecondStageFormat = selectedEvent?.format === 'SINGLE_ELIMINATION_PLUS_GROUP_RANKING';
  const isStandardSecondStageFormat = selectedEvent?.format === 'GROUP_PLUS_KNOCKOUT_STD';
  const isSecondStageFormat = isManualSecondStageFormat || isStandardSecondStageFormat;
  // 标准2023 出线超过 8 人：小组赛结束后自动生成淘汰赛，不显示 A-H 第二阶段区块。
  const standardAutoKnockout = isStandardSecondStageFormat ? visibleBracket?.autoKnockout ?? null : null;
  const standardEligibleEntrants = visibleBracket?.secondStage?.eligibleEntrants ?? [];
  // 标准2023的官方出线名次只有在小组赛全部完赛后才会产生。出线名次尚未产生时，
  // 回退到「全部已通过报名」作为候选，让管理员仍能在第二阶段区块手动指定签位
  //（否则下拉为空，会出现“选不了选手”）。出线名次已产生时仍只允许选出线队伍。
  const hasOfficialQualifiers = isStandardSecondStageFormat && standardEligibleEntrants.length > 0;
  const secondStageCandidates = useMemo(() => {
    if (isStandardSecondStageFormat && standardEligibleEntrants.length > 0) {
      return standardEligibleEntrants.map((entrant) => ({
        value: entrant.playerId,
        label: `${entrant.playerName ?? '待定'} · ${entrant.group ?? '-'}组第${entrant.rank ?? '-'}名`,
      }));
    }
    return visibleRegistrations.map((registration) => ({
      value: registration.id,
      label: sideName(registration),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStandardSecondStageFormat, visibleBracket?.secondStage?.eligibleEntrants, visibleRegistrations]);
  // 出线队伍超过 8 支（系统已走常规淘汰签表）时禁用确认；其余情况只要有 ≥2 名可选即可确认。
  const tooManyStandardQualifiers =
    hasOfficialQualifiers && standardEligibleEntrants.length > SECOND_STAGE_SLOT_CODES.length;
  const canConfirmSecondStage = secondStageCandidates.length >= 2 && !tooManyStandardQualifiers;
  const standardSecondStageAutoText =
    (selectedEvent?.qualifiersPerGroup ?? 2) <= 1 ? '随机补齐' : '按组别交叉补齐';
  const slotSourceLabelMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const slot of visibleBracket?.secondStage?.slots ?? []) {
      if (slot.sourceLabel) map.set(slot.slot, slot.sourceLabel);
    }
    return map;
  }, [visibleBracket?.secondStage?.slots]);
  const secondStageStatus = String(
    visibleBracket?.secondStage?.secondStageStatus ?? visibleBracket?.secondStage?.status ?? 'NOT_STARTED',
  ).toUpperCase();
  const secondStageConfirmed = secondStageStatus === 'CONFIRMED' || secondStageStatus === 'FINISHED';
  const unplacedRegistrations = useMemo(() => {
    if (!visibleBracket?.rounds.length) return [];
    const placedIds = new Set(
      visibleBracket.rounds.flatMap((round) =>
        round.matches.flatMap((match) => [match.side1?.id, match.side2?.id].filter(Boolean) as string[]),
      ),
    );
    return visibleRegistrations.filter((registration) => !placedIds.has(registration.id));
  }, [visibleBracket, visibleRegistrations]);
  const unplacedPreviewText = useMemo(() => {
    const preview = unplacedRegistrations.slice(0, 4).map(sideName).join('、');
    const restCount = unplacedRegistrations.length - 4;
    return restCount > 0 ? `${preview} 等 ${unplacedRegistrations.length} 名/队` : preview;
  }, [unplacedRegistrations]);
  const pendingRedrawRequest = useMemo(
    () =>
      redrawRequests.find(
        (item) => item.eventItemId === selectedEventId && item.status === 'PENDING',
      ) ?? null,
    [redrawRequests, selectedEventId],
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
        apiFetch<Player[]>('/players?includeTemporary=true', { token }),
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
    loadTeamCompetitions(selectedTournamentId).catch((error) => message.error(error instanceof Error ? error.message : '加载团体赛失败'));
  }, [token, selectedTournamentId]);

  useEffect(() => {
    if (!token || !selectedTeamCompetitionId) { setTeamCompetitionTeams([]); return; }
    loadTeamCompetitionTeams(selectedTeamCompetitionId)
      .catch((error) => message.error(error instanceof Error ? error.message : '加载团体队伍失败'));
  }, [token, selectedTeamCompetitionId]);

  async function loadTeamCompetitions(tournamentId: string) {
    if (!token) return;
    const data = await apiFetch<TeamCompetitionOption[]>(`/team-competitions?tournamentId=${tournamentId}`, { token });
    setTeamCompetitions(data);
    setSelectedTeamCompetitionId((current) => (data.some((item) => item.id === current) ? current : data[0]?.id ?? ''));
  }

  async function loadTeamCompetitionTeams(competitionId: string) {
    if (!token || !competitionId) return;
    const data = await apiFetch<TeamCompetitionTeam[]>(`/team-competitions/${competitionId}/teams`, { token });
    setTeamCompetitionTeams(data);
  }

  async function refreshTeamCompetition() {
    await loadTeamCompetitionTeams(selectedTeamCompetitionId);
    await loadTeamCompetitions(selectedTournamentId);
  }

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

  async function handleUpdateSeed() {
    if (!editingRegistration) return;
    const values = await seedForm.validateFields();
    try {
      await apiFetch(`/registrations/${editingRegistration.id}`, {
        method: 'PATCH',
        token,
        body: JSON.stringify({
          isSeed: values.isSeed ?? false,
          seedRank: values.isSeed ? values.seedRank : null,
        }),
      });
      message.success('种子设置已更新，重新抽签后生效');
      setEditingRegistration(null);
      seedForm.resetFields();
      refreshDraw();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '种子设置更新失败');
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
      message.success(force ? '已重新抽签，可调整签位后发布' : '抽签完成，可调整签位后点击发布');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '抽签失败');
    } finally {
      setLoading(false);
    }
  }

  async function handleClearAllDraws() {
    if (!token || !selectedTournamentId) return;
    setLoading(true);
    try {
      const res = await apiFetch<{ cleared: number }>(
        `/tournaments/${selectedTournamentId}/draws/clear`,
        { method: 'POST', token },
      );
      message.success(`已取消全部编排，共清空 ${res.cleared} 个单项`);
      await loadEvents(selectedTournamentId);
      await refreshDraw();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '取消全部编排失败');
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
      message.success('已提交重抽申请，等待超级管理员审批');
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
      message.success(
        isStandardSecondStageFormat
          ? hasOfficialQualifiers
            ? `第二阶段已生成：手动签位已保留，其余出线队伍${standardSecondStageAutoText}`
            : '第二阶段已按手动指定签位生成（小组赛全部完赛后可重新确认以套用官方出线名次）'
          : '第二阶段已确认生成，前台对阵表会同步显示',
      );
    } catch (error) {
      message.error(error instanceof Error ? error.message : '第二阶段生成失败');
    }
  }

  const playerOptions = players.map((player) => ({
    value: player.id,
    label: `${player.name} · ${player.gender === 'MALE' ? '男' : player.gender === 'FEMALE' ? '女' : '未填写'} · ${player.affiliation}`,
  }));

  const registrationColumns = [
    {
      title: '报名',
      render: (_: unknown, row: Registration) => {
        const name = sideName(row);
        const unit = affiliation(row);
        return (
          <Space direction="vertical" size={0} style={{ maxWidth: 220 }}>
            <Typography.Text strong ellipsis={{ tooltip: name }} style={{ maxWidth: 220 }}>
              {name}
            </Typography.Text>
            <Typography.Text type="secondary" ellipsis={{ tooltip: unit }} style={{ maxWidth: 220 }}>
              {unit}
            </Typography.Text>
          </Space>
        );
      },
    },
    {
      title: '种子',
      width: 150,
      render: (_: unknown, row: Registration) => (
        <Space size={4}>
          {row.isSeed ? (
            <Tag color="gold">{row.seedRank}号种子</Tag>
          ) : (
            <Typography.Text type="secondary">非种子</Typography.Text>
          )}
          <Button
            size="small"
            type="link"
            icon={<StarFilled />}
            disabled={selectedEvent?.drawLocked || isMixMember}
            onClick={() => setEditingRegistration(row)}
          >
            设置
          </Button>
        </Space>
      ),
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

  // 重新抽签前后的分组对比：让管理员在覆盖已有对阵前看到「会从几组变成几组」。
  const drawChangeHint = (() => {
    const plan = bracket?.groupPlan;
    if (!plan || !bracket?.currentDraw) return null;
    const currentSizes = bracket.groups.map((group) => group.registrations.length);
    if (!currentSizes.length) return null;
    const currentMatches = groupMatchCount(currentSizes);
    const planMatches = groupMatchCount(plan.sizes);
    const same = currentSizes.length === plan.sizes.length && currentMatches === planMatches;
    if (same) return null;
    return `分组将从 ${currentSizes.length} 组（${currentSizes.join('+')}，${currentMatches} 场）变为 ${plan.groupCount} 组（${plan.sizes.join('+')}，${planMatches} 场）。`;
  })();

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
          <Button icon={<SwapOutlined />} onClick={() => setSwapEventOpen(true)} disabled={!selectedEventId}>
            换签位
          </Button>
          <ClearResultsButton scope="event" id={selectedEventId} token={token} disabled={loading || !selectedEventId || !bracket?.currentDraw} onChanged={refreshDraw} />
          {userRole === 'ROOT' && (
            <Popconfirm
              title="清空该赛事下所有单项的抽签、对阵与比赛结果（报名名单保留），且无法撤销，确认继续？"
              onConfirm={handleClearAllDraws}
              disabled={!selectedTournamentId}
            >
              <Button danger icon={<DeleteOutlined />} disabled={!selectedTournamentId}>
                取消全部编排
              </Button>
            </Popconfirm>
          )}
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
                  <div>
                    <div>
                      {selectedEvent?.drawPublished
                        ? '对阵已发布，重抽会清空所有比赛结果并取消发布，确认继续？'
                        : '重新抽签会覆盖当前对阵，确认继续？'}
                    </div>
                    {drawChangeHint && (
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {drawChangeHint}
                      </Typography.Text>
                    )}
                  </div>
                }
                onConfirm={() => handleDraw(true)}
              >
                <Button danger icon={<BranchesOutlined />} disabled={!selectedEventId || registrations.length < 2 || Boolean(bracket?.groupPlan?.errors.length)}>
                  重新抽签
                </Button>
              </Popconfirm>
            )
          ) : (
            <Button type="primary" icon={<BranchesOutlined />} onClick={() => handleDraw(false)} disabled={!selectedEventId || isMixMember || registrations.length < 2 || Boolean(bracket?.groupPlan?.errors.length)}>
              抽签
            </Button>
          )}
        </Space>
      </div>

      <UnpaidNotice kind="event" id={selectedEventId || undefined} token={token} revision={registrations} />
      <DrawStaleNotice eventId={selectedEventId || undefined} token={token} revision={bracket?.currentDraw?.id ?? registrations} />

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
                label: event.mixHostId
                  ? `${drawEventLabel(event)} · 已并入混编`
                  : `${drawEventLabel(event)} · ${FORMAT_LABELS[event.format] || event.format}`,
              }))}
            />
          </Col>
          <Col xs={24} md={4}>
            {isMixMember ? (
              <Tag color="blue">已并入混编</Tag>
            ) : !bracket?.currentDraw ? (
              <Tag color="default">未抽签</Tag>
            ) : selectedEvent?.drawPublished ? (
              <Tag color="green">已发布</Tag>
            ) : (
              <Tag color="orange">未发布</Tag>
            )}
          </Col>
        </Row>
      </section>

      {selectedEvent?.mixHostId && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message={`这个单项已并入混编「${selectedEvent.mixHostLabel ?? '混编'}」`}
          description="它的选手和主项目一起抽签、比赛、排名，这里不能单独抽签。请到主项目操作；要取消混编，请到单项管理（只能在抽签前取消）。"
          action={(
            <Button size="small" type="primary" onClick={() => setSelectedEventId(selectedEvent.mixHostId!)}>
              转到主项目
            </Button>
          )}
        />
      )}
      {selectedEvent?.mixLabel && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message={`混编：${selectedEvent.mixLabel}`}
          description="并入项目的选手和这个主项目一起抽签、比赛、排名，按主项目的赛制和计分规则。"
        />
      )}

      {bracket?.groupPlanDrift && bracket.event.id === selectedEventId && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="当前签表和分组设置不一致，重新抽签后才会按新设置分组"
          description={`当前签表 ${bracket.groupPlanDrift.currentGroupCount} 组（${bracket.groupPlanDrift.currentSizes.join('+')}），按${
            bracket.groupPlanDrift.settingsChangedAfterDraw ? '修改后的' : '现在的'
          }分组设置应为 ${bracket.groupPlanDrift.planGroupCount} 组（${bracket.groupPlanDrift.planSizes.join('+')}）。${
            bracket.event.drawPublished
              ? `对阵已发布，重新抽签会清空已有比赛结果并取消发布${isSuperAdmin ? '' : '，需要先提交重抽申请'}。`
              : '确认无误后点右上角「重新抽签」。'
          }`}
        />
      )}

      {isSuperAdmin && bracket && bracket.event.id === selectedEventId && GROUP_NAMING_FORMATS.has(bracket.event.format) && (
        <GroupSettingsPanel
          event={bracket.event}
          token={token}
          showGroupConfig={GROUP_SETTING_FORMATS.has(bracket.event.format)}
          hasDraw={Boolean(bracket.currentDraw)}
          onNamingSaved={async (naming) => {
            setEvents((prev) => prev.map((item) => (item.id === bracket.event.id ? { ...item, groupNaming: naming } : item)));
            await refreshDraw();
          }}
          onSaved={async (updated) => {
            setEvents((prev) =>
              prev.map((item) =>
                item.id === updated.id
                  ? {
                      ...item,
                      groupSize: updated.groupSize,
                      groupCount: updated.groupCount,
                      qualifiersPerGroup: updated.qualifiersPerGroup,
                    }
                  : item,
              ),
            );
            await refreshDraw();
          }}
        />
      )}

      {bracket?.groupPlan && bracket.groupPlan.entrantCount >= 2 && (
        <Alert
          type={bracket.groupPlan.errors.length ? 'warning' : 'info'}
          showIcon
          style={{ marginBottom: 16 }}
          message={`分组规则（重新抽签生效）：${
            bracket.groupPlan.manualGroupCount
              ? `手动 ${bracket.groupPlan.groupCount} 组`
              : `每组 ${bracket.groupPlan.groupSize ?? 4} 人（自动算组数）`
          }${
            bracket.groupPlan.secondStage === 'PLAYOFF'
              ? ''
              : ` · 每组出线 ${bracket.groupPlan.qualifiersPerGroup} 人`
          }`}
          description={
            bracket.groupPlan.errors.length
              ? `${bracket.groupPlan.errors.join('；')}（调整单项的分组设置后才能抽签）`
              : groupPlanSummary(bracket.groupPlan)
          }
        />
      )}

      {teamCompetitions.length > 0 && (
        <section style={{ marginBottom: 16, border: '1px solid #f0f0f0', borderRadius: 8, padding: 16, background: '#fff' }}>
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Space wrap align="center">
              <Typography.Text strong>团体赛分组编排</Typography.Text>
              <Select
                style={{ minWidth: 280 }}
                placeholder="选择团体赛"
                value={selectedTeamCompetitionId || undefined}
                onChange={setSelectedTeamCompetitionId}
                options={teamCompetitions.map((item) => ({
                  value: item.id,
                  label: `${item.name} · ${item._count?.teams ?? 0} 队`,
                }))}
              />
              <Typography.Text type="secondary">
                {selectedTeamCompetition?.format === 'ROUND_ROBIN'
                  ? '全部队伍在同一组，每两队交手一次。自动排程后，可在下方对阵表手工调整场地与时间，保留的空闲场地也可使用。'
                  : '抽签后可在此手动移动队伍分组；保存会重新生成小组对阵。对阵表可手工调整场地与时间。'}
              </Typography.Text>
              <Button
                icon={<SwapOutlined />}
                disabled={!selectedTeamCompetitionId || !(selectedTeamCompetition?._count?.teamMatches ?? 0)}
                onClick={() => setSwapTeamOpen(true)}
              >
                换签位
              </Button>
            </Space>
            {selectedTeamCompetition && (
              <TeamCompetitionGroups
                competitionId={selectedTeamCompetition.id}
                token={token}
                teams={teamCompetitionTeams}
                format={selectedTeamCompetition.format}
                hasDraw={(selectedTeamCompetition._count?.teamMatches ?? 0) > 0}
                onChanged={refreshTeamCompetition}
                showDraw
              />
            )}
          </Space>
        </section>
      )}

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
          <Col span={24}>
            <section
              style={{
                border: '1px solid #f0f0f0',
                borderRadius: 8,
                padding: 16,
                background: '#fff',
              }}
            >
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
                message={selectedEvent
                  ? `${drawEventLabel(selectedEvent)} · ${isMixMember ? '已并入混编，在主项目抽签' : FORMAT_LABELS[selectedEvent.format]}`
                  : '请选择单项'}
              />
              {!selectedEvent?.drawLocked && unplacedRegistrations.length > 0 && (
                <Alert
                  type="warning"
                  showIcon
                  style={{ marginBottom: 12 }}
                  message={`有 ${unplacedRegistrations.length} 名/队未排位`}
                  description={`${unplacedPreviewText}。重新抽签后才会进入对阵。`}
                />
              )}
              <Table
                rowKey="id"
                size="small"
                columns={registrationColumns}
                dataSource={visibleRegistrations}
                pagination={{ pageSize: 8, size: 'small', showSizeChanger: false }}
                tableLayout="fixed"
              />
            </section>
          </Col>
          <Col span={24}>
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <section
                style={{
                  border: '1px solid #f0f0f0',
                  borderRadius: 8,
                  padding: 16,
                  background: '#fff',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 12, flexWrap: 'wrap' }}>
                  <Typography.Title level={5} style={{ margin: 0 }}>对阵图</Typography.Title>
                  <Typography.Text type="secondary">
                    {selectedEvent?.drawGeneratedAt
                      ? `生成时间：${new Date(selectedEvent.drawGeneratedAt).toLocaleString()}`
                      : '尚未生成'}
                  </Typography.Text>
                </div>
                <div>
                  <BracketRenderer data={visibleBracket} />
                </div>
              </section>
              {standardAutoKnockout && (
                <Alert
                  type="info"
                  showIcon
                  message={`本项目出线 ${standardAutoKnockout.qualifiers} 人，超过 A-H 的 8 个签位，不使用 A-H 第二阶段`}
                  description="小组赛全部结束后，系统按官方名次自动生成淘汰赛：轮空优先给小组第一，同组第一、第二分在上下半区。抽签后可在上方「淘汰赛对阵（预览）」查看签表；前台对阵表、秩序册使用同一份签表。"
                />
              )}
              {isSecondStageFormat && !standardAutoKnockout && (
                <section style={{ border: '1px solid #d9f7be', borderRadius: 8, padding: 16, background: '#fff' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 12, flexWrap: 'wrap' }}>
                    <div>
                      <Typography.Title level={5} style={{ margin: 0 }}>
                        {isStandardSecondStageFormat ? '第二阶段：标准2023淘汰排位' : '第二阶段：小组赛排位赛'}
                      </Typography.Title>
                      <Typography.Text type="secondary">
                        {isStandardSecondStageFormat
                          ? `小组赛全部结束后，系统按单项设置取出线队伍；可手动指定 A-H，未指定部分${standardSecondStageAutoText}。`
                          : '分组方式：裁判手动指定；签位来源：组委会手动安排。'}
                      </Typography.Text>
                    </div>
                    <Button type="primary" icon={<TrophyOutlined />} onClick={handleConfirmSecondStage} disabled={!selectedEventId || !canConfirmSecondStage}>
                      确认生成第二阶段
                    </Button>
                  </div>
                  <Alert
                    type="info"
                    showIcon
                    style={{ marginBottom: 12 }}
                    message={
                      isStandardSecondStageFormat
                        ? `可手动指定 A-H；不指定时${standardSecondStageAutoText}`
                        : '请手动指定 A-H 签位（可留空＝轮空）'
                    }
                    description={
                      isStandardSecondStageFormat
                        ? '取每组第一时随机排入 A-H；取每组前二时按 A组第一 vs B组第二、A组第二 vs B组第一 这类交叉规则生成。首轮负者进入 5-8 名争夺区；排名范围可设置为取前6名或取前8名。'
                        : '确认后会生成 A vs B、C vs D、E vs F、G vs H，并按 TOP_6 / TOP_8 自动准备后续排位赛。签位可留空或选“轮空”（至少需 2 名选手），轮空位的对手不战自动晋级。重新抽签会清空已指定的 A-H 签位，需重新指定。'
                    }
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
                            label={
                              slotSourceLabelMap.get(slot)
                                ? `${slot} 签位 · ${slotSourceLabelMap.get(slot)}`
                                : `${slot} 签位`
                            }
                          >
                            <Select
                              showSearch
                              allowClear
                              placeholder="留空 = 轮空"
                              optionFilterProp="label"
                              options={[
                                { value: SECOND_STAGE_BYE, label: '轮空（空位，对手不战晋级）' },
                                ...secondStageCandidates,
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
                        type={secondStageConfirmed ? 'success' : 'warning'}
                        showIcon
                        style={{ marginTop: 12 }}
                        message={secondStageConfirmed ? '第二阶段正式比赛已生成' : '第二阶段对阵预览'}
                        description={
                          secondStageConfirmed
                            ? 'A-H 签位确认后，系统会生成正式比赛；后续比分由赛程/裁判记分同步，胜负关系自动推进，不需要在这里手动录入。'
                            : `当前仅展示 A-H 签位与胜负推进结构。小组赛完成后可手动指定签位，或直接确认让系统${standardSecondStageAutoText}。`
                        }
                      />
                    </div>
                  ) : null}
                </section>
              )}
            </Space>
          </Col>
        </Row>
      </Spin>

      <DrawSwapModal
        open={swapEventOpen}
        token={token}
        optionsUrl={selectedEventId ? `/events/${selectedEventId}/draw/swap-options` : null}
        submitUrl={selectedEventId ? `/events/${selectedEventId}/draw/swap` : null}
        title="换签位"
        onClose={() => setSwapEventOpen(false)}
        onDone={refreshDraw}
      />

      <DrawSwapModal
        open={swapTeamOpen}
        token={token}
        optionsUrl={
          selectedTeamCompetitionId ? `/team-competitions/${selectedTeamCompetitionId}/draw/swap-options` : null
        }
        submitUrl={selectedTeamCompetitionId ? `/team-competitions/${selectedTeamCompetitionId}/draw/swap` : null}
        title="团体赛换签位"
        description="团体赛只换队伍位置：小组赛换小组位置，单淘汰换首轮位置。场地、时间、裁判与子项名单都会保留。"
        onClose={() => setSwapTeamOpen(false)}
        onDone={refreshTeamCompetition}
      />

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
        title="设置种子"
        open={Boolean(editingRegistration)}
        onOk={handleUpdateSeed}
        onCancel={() => {
          setEditingRegistration(null);
          seedForm.resetFields();
        }}
        okText="保存"
        cancelText="取消"
      >
        {editingRegistration && (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message={sideName(editingRegistration)}
            description={affiliation(editingRegistration)}
          />
        )}
        <Form
          form={seedForm}
          layout="vertical"
          key={editingRegistration?.id}
          initialValues={{
            isSeed: editingRegistration?.isSeed ?? false,
            seedRank: editingRegistration?.seedRank ?? undefined,
          }}
        >
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
          description="申请通过后，超级管理员会清空当前所有比赛结果并重新生成对阵（不会自动重新发布）。"
        />
        <Form form={requestForm} layout="vertical">
          <Form.Item
            name="reason"
            label="申请理由"
            rules={[{ required: true, message: '请填写申请理由，便于超级管理员审批' }]}
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
