'use client';

import type { ReactNode } from 'react';
import { Button, Card, Empty, Pagination, Space, Table, Typography } from 'antd';
import type { TableColumnsType, TablePaginationConfig } from 'antd';
import { EditOutlined } from '@ant-design/icons';
import type { MMMatch } from '@/lib/match-management';
import { AttentionTags, SideName, StatusTag, TeamLine, scoreText, timeText } from './display';

const { Text } = Typography;

/**
 * 列表视图：时间 | 场地 | 项目·阶段 | 场次号 | 对阵（两行，胜方加粗）| 比分 | 状态（带需处理）| 裁判 | 操作。
 * 不再用固定在右边的操作列（1440 宽的屏幕上会挡住状态、场地、裁判）；手机上换成一场一张卡片。
 * 「全部场次」另传 tournamentOf（最前面加一列赛事）和 pagination（后端分页）。
 */
export function MatchList({
  matches,
  now,
  projectOf,
  onOpen,
  onRelease,
  releasingId,
  tournamentOf,
  pagination,
  loading,
}: {
  matches: MMMatch[];
  now: number;
  projectOf: (match: MMMatch) => string;
  onOpen: (matchId: string) => void;
  onRelease: (matchId: string) => void;
  releasingId: string | null;
  tournamentOf?: (match: MMMatch) => ReactNode;
  pagination?: TablePaginationConfig;
  loading?: boolean;
}) {
  const columns: TableColumnsType<MMMatch> = [
    ...(tournamentOf ? [{ title: '赛事', width: 150, render: (_: unknown, match: MMMatch) => tournamentOf(match) }] : []),
    { title: '时间', width: 96, render: (_, match) => <Text style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{timeText(match.scheduledAt)}</Text> },
    { title: '场地', width: 80, render: (_, match) => <Text style={{ fontSize: 12 }}>{match.venue?.name ?? <Text type="secondary" style={{ fontSize: 12 }}>待排</Text>}</Text> },
    {
      title: '项目 · 阶段',
      width: 170,
      render: (_, match) => (
        <div style={{ fontSize: 12, lineHeight: 1.4 }}>
          <div>{projectOf(match)}</div>
          <Text type="secondary" style={{ fontSize: 12 }}>{match.stageLabel} · 第 {match.matchNo} 场</Text>
        </div>
      ),
    },
    { title: '场次号', width: 76, render: (_, match) => <Text strong style={{ fontSize: 12, color: '#0f4c9c' }}>{match.code ?? '—'}</Text> },
    {
      title: '对阵',
      render: (_, match) => (
        <div style={{ fontSize: 13 }}>
          <TeamLine match={match} />
          <SideName match={match} side={1} />
          <SideName match={match} side={2} />
        </div>
      ),
    },
    { title: '比分', width: 120, render: (_, match) => <Text strong style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>{scoreText(match)}</Text> },
    {
      title: '状态',
      width: 110,
      render: (_, match) => (
        <Space size={4} wrap>
          <StatusTag status={match.status} />
          <AttentionTags match={match} now={now} />
        </Space>
      ),
    },
    {
      title: '裁判',
      width: 110,
      render: (_, match) => match.referee ? (
        <div style={{ fontSize: 12 }}>
          <div>{match.referee.username}</div>
          {match.status === 'PENDING' || match.status === 'LIVE' ? (
            <Button type="link" size="small" danger style={{ padding: 0, height: 'auto', fontSize: 12 }}
              loading={releasingId === match.id}
              onClick={(event) => { event.stopPropagation(); onRelease(match.id); }}>
              解除
            </Button>
          ) : null}
        </div>
      ) : <Text type="secondary" style={{ fontSize: 12 }}>未分配</Text>,
    },
    {
      title: '操作',
      width: 76,
      render: (_, match) => (
        <Button size="small" icon={<EditOutlined />} onClick={(event) => { event.stopPropagation(); onOpen(match.id); }}>管理</Button>
      ),
    },
  ];

  return (
    <>
      <Card style={{ marginTop: 16 }} className="hidden md:block" styles={{ body: { padding: 0 } }}>
        <Table
          rowKey="id"
          size="small"
          columns={columns}
          dataSource={matches}
          loading={loading}
          onRow={(match) => ({ onClick: () => onOpen(match.id), style: { cursor: 'pointer' } })}
          pagination={pagination ?? { defaultPageSize: 50, showSizeChanger: true, pageSizeOptions: [20, 50, 100, 200], showTotal: (total) => `共 ${total} 场`, style: { paddingInline: 16 } }}
        />
      </Card>
      {/* 外层只管隐藏：内联的 display:flex 会盖过 md:hidden，电脑上表格下面会再列一遍卡片。 */}
      <div className="md:hidden">
        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {matches.length ? matches.slice(0, 200).map((match) => (
            <button
              key={match.id}
              type="button"
              onClick={() => onOpen(match.id)}
              style={{ textAlign: 'left', border: '1px solid #e2e8f0', borderRadius: 10, background: '#fff', padding: '10px 12px', cursor: 'pointer' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <Text strong style={{ fontSize: 12 }}>{timeText(match.scheduledAt)}</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>{match.venue?.name ?? '待排场地'}</Text>
                {match.code ? <Text strong style={{ fontSize: 12, color: '#0f4c9c' }}>{match.code}</Text> : null}
                <span style={{ marginLeft: 'auto' }}><StatusTag status={match.status} /></span>
              </div>
              {tournamentOf ? <div style={{ fontSize: 12, fontWeight: 700, color: '#334155' }}>{tournamentOf(match)}</div> : null}
              <Text type="secondary" style={{ fontSize: 12 }}>{projectOf(match)} · {match.stageLabel} · 第 {match.matchNo} 场</Text>
              <TeamLine match={match} />
              <div style={{ marginTop: 4, display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'center' }}>
                <div><SideName match={match} side={1} /><SideName match={match} side={2} /></div>
                <Text strong style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>{scoreText(match)}</Text>
              </div>
              <div style={{ marginTop: 4, display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                <Text type="secondary" style={{ fontSize: 12 }}>裁判 {match.referee?.username ?? '未分配'}</Text>
                <AttentionTags match={match} now={now} />
              </div>
            </button>
          )) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有符合条件的场次" />}
          {matches.length > 200 ? <Text type="secondary" style={{ fontSize: 12 }}>只显示前 200 场，请用搜索或筛选缩小范围</Text> : null}
          {pagination ? (
            <Pagination
              simple
              current={pagination.current}
              pageSize={pagination.pageSize}
              total={pagination.total}
              onChange={pagination.onChange}
              style={{ alignSelf: 'center', marginTop: 4 }}
            />
          ) : null}
        </div>
      </div>
    </>
  );
}
