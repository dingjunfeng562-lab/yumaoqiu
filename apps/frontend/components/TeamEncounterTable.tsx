'use client';

import { Button, Space, Table, Tag } from 'antd';
import dayjs from 'dayjs';

export type TeamEncounterGame = {
  gameNo: number;
  side1Score: number;
  side2Score: number;
  winnerSide?: number | null;
};

export type TeamEncounterChild = {
  id: string;
  matchNo: number;
  status: string;
  lineupLocked?: boolean;
  eventType?: string | null;
  eventTypeLabel?: string | null;
  winnerSide?: number | null;
  side1Name?: string | null;
  side2Name?: string | null;
  referee?: string | null;
  venue?: { id: string; name: string } | null;
  scheduledAt?: string | null;
  games?: TeamEncounterGame[];
};

export type TeamEncounter = {
  id: string;
  round: string;
  roundNo?: number;
  matchNo: number;
  stage?: string | null;
  team1?: { id: string; name: string } | null;
  team2?: { id: string; name: string } | null;
  team1Wins: number;
  team2Wins: number;
  status: string;
  winnerTeamId?: string | null;
  children: TeamEncounterChild[];
};

export const TEAM_MATCH_STATUS_LABEL: Record<string, string> = {
  PENDING: '未开始',
  LIVE: '进行中',
  COMPLETED: '已结束',
  CANCELLED: '无需比赛',
};

const STATUS_COLOR: Record<string, string | undefined> = {
  LIVE: 'blue',
  COMPLETED: 'green',
  CANCELLED: 'default',
};

/** 每个子项的每局比分，例如 21:15 / 18:21 / 21:19。 */
function gameScores(child: TeamEncounterChild) {
  const games = child.games ?? [];
  if (!games.length) return '-';
  return games.map((game) => `${game.side1Score}:${game.side2Score}`).join(' / ');
}

function sideName(name?: string | null) {
  return name?.trim() || '待填报';
}

export default function TeamEncounterTable({
  encounters,
  busy,
  showRound = true,
  canSchedule = false,
  onSchedule,
}: {
  encounters: TeamEncounter[];
  busy?: boolean;
  showRound?: boolean;
  canSchedule?: boolean;
  onSchedule?: (encounter: TeamEncounter) => void;
}) {
  const childColumns = (encounter: TeamEncounter) => [
    {
      title: '子项',
      width: 96,
      render: (_: unknown, child: TeamEncounterChild) =>
        `${child.matchNo}. ${child.eventTypeLabel ?? '子项'}`,
    },
    {
      title: encounter.team1?.name ?? '队伍一',
      render: (_: unknown, child: TeamEncounterChild) => (
        <Space size={4}>
          <span>{sideName(child.side1Name)}</span>
          {child.winnerSide === 1 && <Tag color="green">胜</Tag>}
        </Space>
      ),
    },
    {
      title: encounter.team2?.name ?? '队伍二',
      render: (_: unknown, child: TeamEncounterChild) => (
        <Space size={4}>
          <span>{sideName(child.side2Name)}</span>
          {child.winnerSide === 2 && <Tag color="green">胜</Tag>}
        </Space>
      ),
    },
    {
      title: '局分',
      width: 170,
      render: (_: unknown, child: TeamEncounterChild) => (
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{gameScores(child)}</span>
      ),
    },
    {
      title: '状态',
      width: 88,
      render: (_: unknown, child: TeamEncounterChild) => (
        <Tag color={STATUS_COLOR[child.status]}>{TEAM_MATCH_STATUS_LABEL[child.status] ?? child.status}</Tag>
      ),
    },
    {
      title: '场地',
      width: 96,
      render: (_: unknown, child: TeamEncounterChild) => child.venue?.name || '-',
    },
  ];

  const columns = [
    ...(showRound
      ? [
          {
            title: '轮次',
            width: 120,
            render: (_: unknown, encounter: TeamEncounter) =>
              `${encounter.round} / 第 ${encounter.matchNo} 场`,
          },
        ]
      : []),
    {
      title: '对阵',
      render: (_: unknown, encounter: TeamEncounter) => {
        // 已结束且一侧为空的首轮场次是轮空，其余空位代表“待定”。
        const finishedWithOneSide = encounter.status === 'COMPLETED' && Boolean(encounter.team1) !== Boolean(encounter.team2);
        const name = (team?: { name: string } | null) => team?.name ?? (finishedWithOneSide ? '轮空' : '待定');
        return `${name(encounter.team1)} VS ${name(encounter.team2)}`;
      },
    },
    {
      title: '场地',
      width: 100,
      render: (_: unknown, encounter: TeamEncounter) => encounter.children[0]?.venue?.name ?? '未分配',
    },
    {
      title: '开始时间',
      width: 130,
      render: (_: unknown, encounter: TeamEncounter) =>
        encounter.children[0]?.scheduledAt
          ? dayjs(encounter.children[0].scheduledAt).format('MM-DD HH:mm')
          : '未排程',
    },
    {
      title: '总比分',
      width: 90,
      render: (_: unknown, encounter: TeamEncounter) => (
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{`${encounter.team1Wins} : ${encounter.team2Wins}`}</span>
      ),
    },
    {
      title: '子项进度',
      width: 96,
      render: (_: unknown, encounter: TeamEncounter) => {
        const total = encounter.children.length;
        const done = encounter.children.filter((child) =>
          ['COMPLETED', 'CANCELLED'].includes(child.status),
        ).length;
        return total ? `${done}/${total}` : '-';
      },
    },
    {
      title: '状态',
      width: 96,
      render: (_: unknown, encounter: TeamEncounter) => (
        <Tag color={STATUS_COLOR[encounter.status]}>{TEAM_MATCH_STATUS_LABEL[encounter.status] ?? encounter.status}</Tag>
      ),
    },
    ...(canSchedule
      ? [
          {
            title: '排程',
            width: 150,
            render: (_: unknown, encounter: TeamEncounter) => (
              <Button
                size="small"
                disabled={busy || !encounter.children.some((child) => child.status === 'PENDING') || !onSchedule}
                onClick={() => onSchedule?.(encounter)}
              >
                调整场地与时间
              </Button>
            ),
          },
        ]
      : []),
  ];

  return (
    <Table<TeamEncounter>
      rowKey="id"
      size="small"
      pagination={false}
      dataSource={encounters}
      columns={columns}
      scroll={{ x: showRound ? 960 : 840 }}
      expandable={{
        rowExpandable: (encounter) => encounter.children.length > 0,
        expandedRowRender: (encounter) => (
          <Table<TeamEncounterChild>
            rowKey="id"
            size="small"
            pagination={false}
            dataSource={encounter.children}
            columns={childColumns(encounter)}
            scroll={{ x: 640 }}
          />
        ),
      }}
    />
  );
}
