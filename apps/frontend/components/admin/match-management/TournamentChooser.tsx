'use client';

import { useMemo, useState } from 'react';
import dayjs from 'dayjs';
import { Badge, Card, Empty, Input, Segmented, Select, Space, Table, Tag, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import {
  TOURNAMENT_STATUS_LABELS,
  filterTournaments,
  sortTournaments,
  tournamentBucket,
  tournamentSearchText,
  type MMTournament,
} from '@/lib/match-management';

const { Text } = Typography;

const STATUS_COLORS: Record<string, string> = {
  ONGOING: 'green',
  REGISTRATION_OPEN: 'orange',
  REGISTRATION_CLOSED: 'gold',
  REGISTRATION_NOT_STARTED: 'default',
  FINISHED: 'blue',
};

function dateRange(tournament: MMTournament) {
  const start = dayjs(tournament.startDate);
  const end = dayjs(tournament.endDate);
  return start.isSame(end, 'day') ? start.format('YYYY-MM-DD') : `${start.format('YYYY-MM-DD')} ~ ${end.format('MM-DD')}`;
}

export function TournamentStatusTag({ tournament }: { tournament: MMTournament }) {
  if (tournament.isArchived) return <Tag style={{ marginInlineEnd: 0 }}>已归档</Tag>;
  return (
    <Tag color={STATUS_COLORS[tournament.status] ?? 'default'} style={{ marginInlineEnd: 0 }}>
      {TOURNAMENT_STATUS_LABELS[tournament.status] ?? tournament.status}
    </Tag>
  );
}

/**
 * 页面顶部切换赛事：可按名称、地点、主办方、创建账号搜；每一项带状态、日期和进行中场次。
 * 顺序：进行中 → 即将开始 → 已结束 → 归档。
 */
export function TournamentPicker({
  tournaments,
  value,
  loading,
  showOwner,
  now,
  onChange,
}: {
  tournaments: MMTournament[];
  value: string | null;
  loading: boolean;
  showOwner: boolean;
  now: number;
  onChange: (id: string) => void;
}) {
  const sorted = useMemo(() => sortTournaments(tournaments, now), [tournaments, now]);
  return (
    <Select
      style={{ width: 'min(520px, 100%)' }}
      placeholder="选择赛事（可搜名称 / 地点 / 主办方）"
      value={value ?? undefined}
      loading={loading}
      showSearch
      filterOption={(input, option) => {
        const item = sorted.find((tournament) => tournament.id === option?.value);
        return item ? tournamentSearchText(item).replace(/\s+/g, '').includes(input.trim().toLowerCase().replace(/\s+/g, '')) : false;
      }}
      onChange={onChange}
      options={sorted.map((tournament) => ({ value: tournament.id, label: tournament.name }))}
      optionRender={(option) => {
        const tournament = sorted.find((item) => item.id === option.value);
        if (!tournament) return option.label;
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tournament.name}</span>
            {(tournament.matchLive ?? 0) > 0 ? <Badge status="processing" text={<span style={{ fontSize: 12 }}>{tournament.matchLive} 场进行中</span>} /> : null}
            <TournamentStatusTag tournament={tournament} />
            <span style={{ fontSize: 12, color: '#94a3b8', whiteSpace: 'nowrap' }}>{dayjs(tournament.startDate).format('MM-DD')}</span>
            {showOwner && tournament.owner ? <span style={{ fontSize: 12, color: '#94a3b8', whiteSpace: 'nowrap' }}>{tournament.owner}</span> : null}
          </div>
        );
      }}
    />
  );
}

type Bucket = 'ALL' | 'ACTIVE' | 'FINISHED';

/**
 * 还没选赛事时直接列出赛事（不再是一个空页面）：搜索 + 「进行中和即将开始 / 已结束 / 全部」，点一行进入。
 * 超级管理员多一列「创建账号」。
 */
export function TournamentDirectory({
  tournaments,
  loading,
  showOwner,
  now,
  onPick,
}: {
  tournaments: MMTournament[];
  loading: boolean;
  showOwner: boolean;
  now: number;
  onPick: (id: string) => void;
}) {
  const [keyword, setKeyword] = useState('');
  const [bucket, setBucket] = useState<Bucket>('ACTIVE');
  const sorted = useMemo(() => sortTournaments(tournaments, now), [tournaments, now]);
  const rows = useMemo(() => filterTournaments(sorted, keyword).filter((tournament) => {
    const group = tournamentBucket(tournament, now);
    if (bucket === 'ACTIVE') return group <= 1;
    if (bucket === 'FINISHED') return group >= 2;
    return true;
  }), [sorted, keyword, bucket, now]);
  const activeCount = sorted.filter((tournament) => tournamentBucket(tournament, now) <= 1).length;

  const columns: TableColumnsType<MMTournament> = [
    {
      title: '赛事',
      render: (_, tournament) => (
        <div style={{ minWidth: 0 }}>
          <Text strong>{tournament.name}</Text>
          <div style={{ fontSize: 12, color: '#64748b' }}>
            {[tournament.location, tournament.organizer].filter(Boolean).join(' · ') || '—'}
          </div>
        </div>
      ),
    },
    { title: '状态', width: 110, render: (_, tournament) => <TournamentStatusTag tournament={tournament} /> },
    { title: '比赛日期', width: 180, render: (_, tournament) => <Text style={{ fontSize: 12 }}>{dateRange(tournament)}</Text> },
    {
      title: '场次',
      width: 170,
      render: (_, tournament) => (
        <Space size={6} wrap>
          <Text style={{ fontSize: 12 }}>共 {tournament.matchTotal ?? 0}</Text>
          {(tournament.matchLive ?? 0) > 0 ? <Tag color="green" style={{ marginInlineEnd: 0 }}>{tournament.matchLive} 场进行中</Tag> : null}
          {(tournament.matchTotal ?? 0) > 0 ? <Text type="secondary" style={{ fontSize: 12 }}>已结束 {tournament.matchCompleted ?? 0}</Text> : null}
        </Space>
      ),
    },
    ...(showOwner ? [{ title: '创建账号', width: 130, render: (_: unknown, tournament: MMTournament) => <Text style={{ fontSize: 12 }}>{tournament.owner ?? '—'}</Text> }] : []),
  ];

  return (
    <Card style={{ marginTop: 16 }} title="选择要管理的赛事" extra={<Text type="secondary" style={{ fontSize: 12 }}>点一行进入</Text>}>
      <Space wrap style={{ marginBottom: 12 }}>
        <Input
          allowClear
          prefix={<SearchOutlined />}
          placeholder={showOwner ? '搜赛事名称 / 地点 / 主办方 / 创建账号' : '搜赛事名称 / 地点 / 主办方'}
          style={{ width: 'min(360px, 80vw)' }}
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
        />
        <Segmented
          value={bucket}
          onChange={(value) => setBucket(value as Bucket)}
          options={[
            { value: 'ACTIVE', label: `进行中和即将开始 ${activeCount}` },
            { value: 'FINISHED', label: '已结束' },
            { value: 'ALL', label: `全部 ${sorted.length}` },
          ]}
        />
      </Space>
      <Table
        rowKey="id"
        size="middle"
        loading={loading}
        columns={columns}
        dataSource={rows}
        locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={keyword ? `没有找到「${keyword.trim()}」` : '这里没有赛事'} /> }}
        pagination={{ pageSize: 20, hideOnSinglePage: true, showTotal: (total) => `共 ${total} 个赛事` }}
        onRow={(tournament) => ({ onClick: () => onPick(tournament.id), style: { cursor: 'pointer' } })}
      />
    </Card>
  );
}
