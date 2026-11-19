'use client';

import dayjs from 'dayjs';
import { Tag, Tooltip } from 'antd';
import { ATTENTION_LABELS, ATTENTION_SHORT, matchAttention, sideLabel, sidePlayerNames, type MMMatch, type MMStatus } from '@/lib/match-management';

// 对局管理各视图共用的小展示件：状态标签、需处理标签、双方名字、时间、比分。

export const STATUS_META: Record<MMStatus, { label: string; color: string }> = {
  PENDING: { label: '未开始', color: 'default' },
  LIVE: { label: '进行中', color: 'green' },
  COMPLETED: { label: '已结束', color: 'blue' },
  CANCELLED: { label: '已取消', color: 'default' },
};

export function StatusTag({ status }: { status: MMStatus }) {
  const meta = STATUS_META[status] ?? STATUS_META.PENDING;
  return <Tag color={meta.color} style={{ marginInlineEnd: 0 }}>{meta.label}</Tag>;
}

export function AttentionTags({ match, now }: { match: MMMatch; now: number }) {
  const list = matchAttention(match, now);
  if (!list.length) return null;
  return (
    <>
      {list.map((key) => (
        <Tooltip key={key} title={ATTENTION_LABELS[key]}>
          <Tag color="red" style={{ marginInlineEnd: 0 }}>{ATTENTION_SHORT[key]}</Tag>
        </Tooltip>
      ))}
    </>
  );
}

export function timeText(value: string | null | undefined, withDate = true) {
  if (!value) return '待排时间';
  return dayjs(value).format(withDate ? 'MM-DD HH:mm' : 'HH:mm');
}

export function scoreText(match: Pick<MMMatch, 'scoreText' | 'forfeitedSide' | 'hasBothSides' | 'status'>) {
  if (match.scoreText) return match.scoreText;
  if (match.forfeitedSide !== null) return 'WO';
  if (!match.hasBothSides && match.status === 'COMPLETED') return '轮空';
  return '未记分';
}

/** 一方的名字一行，双打 / 团体子项下面带小字的选手名；胜方加粗。 */
export function SideName({ match, side }: { match: MMMatch; side: 1 | 2 }) {
  const value = side === 1 ? match.side1 : match.side2;
  const name = sideLabel(value);
  const players = sidePlayerNames(value);
  const winner = match.winnerSide === side;
  return (
    <div style={{ minWidth: 0, lineHeight: 1.35 }}>
      <span style={{ fontWeight: winner ? 800 : 500, color: winner ? '#03205c' : '#334155' }}>{name}</span>
      {winner ? <span style={{ marginLeft: 4, color: '#f59e0b', fontSize: 12 }}>胜</span> : null}
      {players && players !== name ? (
        <div style={{ fontSize: 11, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{players}</div>
      ) : null}
    </div>
  );
}

/** 团体子项：上面一行写团体对阵「一中 vs 二中」。 */
export function TeamLine({ match }: { match: MMMatch }) {
  if (!match.teamMatchId) return null;
  return (
    <div style={{ fontSize: 11, color: '#64748b' }}>
      {match.team1Name ?? '待定'} vs {match.team2Name ?? '待定'}
    </div>
  );
}
