'use client';

import { useState, type ReactNode } from 'react';
import { Button, Card, Empty, Typography } from 'antd';
import { DownOutlined, UpOutlined, WarningFilled } from '@ant-design/icons';
import { matchAttention, sideLabel, type CourtBoard as CourtBoardData, type CourtCard, type MMMatch } from '@/lib/match-management';
import { AttentionTags, SideName, StatusTag, TeamLine, scoreText, timeText } from './display';

const { Text } = Typography;

/** 卡片收起时显示接下来几场；点「查看全部」后就地展开该场地的全部场次。 */
const COLLAPSED_NEXT = 2;

/**
 * 场地视图（现场控制台）：每片场地一张卡。
 * 默认紧凑：进行中（比分/裁判）+ 接下来 2 场 + 「查看全部 N 场」。
 * 点开后**在卡片内展开**这块场地的全部场次（接下来 → 已结束），不弹窗，手机上单手也能看。
 * 没有场地记录的历史场次单独归到「已结束但没有场地记录」，一场不漏。点任意一场打开管理。
 */
export function CourtBoard({
  board,
  now,
  projectOf,
  onOpen,
}: {
  board: CourtBoardData;
  now: number;
  projectOf: (match: MMMatch) => string;
  onOpen: (matchId: string) => void;
}) {
  if (
    !board.courts.length &&
    !board.liveWithoutVenue.length &&
    !board.unscheduled.length &&
    !board.finishedWithoutVenue.length
  ) {
    return (
      <Card style={{ marginTop: 16 }}>
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="这个赛事还没有场地，或者当前筛选下没有场次" />
      </Card>
    );
  }
  const totalShown =
    board.courts.reduce((sum, court) => sum + court.total, 0) +
    board.liveWithoutVenue.length +
    board.unscheduled.length +
    board.finishedWithoutVenue.length;
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ marginBottom: 8, fontSize: 12, color: '#64748b' }}>
        共 {totalShown} 场：进行中 {board.courts.reduce((sum, court) => sum + court.live.length, 0) + board.liveWithoutVenue.length} ·
        待打 {board.courts.reduce((sum, court) => sum + court.pending.length, 0)} ·
        已结束 {board.courts.reduce((sum, court) => sum + court.finished.length, 0) + board.finishedWithoutVenue.length}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
        {board.courts.map((court) => (
          <CourtCardView key={court.venue.id} court={court} now={now} projectOf={projectOf} onOpen={onOpen} />
        ))}
      </div>

      {board.liveWithoutVenue.length ? (
        <Section title={`进行中但没有场地（${board.liveWithoutVenue.length}）`} warn>
          {board.liveWithoutVenue.map((match) => <NextMatch key={match.id} match={match} now={now} projectOf={projectOf} onOpen={onOpen} />)}
        </Section>
      ) : null}
      {board.unscheduled.length ? (
        <div style={{ marginTop: 16, border: '1px solid #e2e8f0', borderRadius: 10, background: '#fff', padding: '10px 12px' }}>
          <Text strong style={{ color: '#334155' }}>还没排场地或时间（{board.unscheduled.length}）</Text>
          <div style={{ marginTop: 8, maxHeight: 640, overflowY: 'auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 8 }}>
            {board.unscheduled.map((match) => <NextMatch key={match.id} match={match} now={now} projectOf={projectOf} onOpen={onOpen} />)}
          </div>
        </div>
      ) : null}
      {board.finishedWithoutVenue.length ? (
        <div style={{ marginTop: 16, border: '1px solid #e2e8f0', borderRadius: 10, background: '#fff', padding: '10px 12px' }}>
          <Text strong style={{ color: '#334155' }}>已结束但没有场地记录（{board.finishedWithoutVenue.length}）</Text>
          <div style={{ marginTop: 8, maxHeight: 640, overflowY: 'auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 6 }}>
            {board.finishedWithoutVenue.map((match) => (
              <FinishedMatch key={match.id} match={match} projectOf={projectOf} onOpen={onOpen} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** 一片场地：默认紧凑，点「查看全部 N 场」在卡片内展开这块场地的全部场次。 */
function CourtCardView({
  court,
  now,
  projectOf,
  onOpen,
}: {
  court: CourtCard;
  now: number;
  projectOf: (match: MMMatch) => string;
  onOpen: (matchId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const busy = court.live.length > 0;
  const hiddenPending = Math.max(0, court.pending.length - COLLAPSED_NEXT);
  const canExpand = hiddenPending > 0 || court.finished.length > 0;
  const shownPending = expanded ? court.pending : court.pending.slice(0, COLLAPSED_NEXT);
  return (
    <div
      style={{
        border: `1px solid ${busy ? '#86efac' : '#e2e8f0'}`,
        borderRadius: 10,
        background: '#fff',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '8px 12px', background: busy ? '#f0fdf4' : '#f8fafc', borderBottom: '1px solid #eef2f7' }}>
        <Text strong style={{ fontSize: 15, color: '#03205c' }}>
          {court.venue.name}{court.venue.isActive ? '' : '（停用）'}
        </Text>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {busy ? '比赛中' : '空闲'} · 共 {court.total} 场 · 待打 {court.pending.length}
        </Text>
      </div>
      {court.live.length > 1 ? (
        <div style={{ padding: '4px 12px', background: '#fef2f2', color: '#b91c1c', fontSize: 12 }}>
          <WarningFilled /> 这片场地同时有 {court.live.length} 场进行中，请核对
        </div>
      ) : null}
      {court.live.map((match) => (
        <LiveMatch key={match.id} match={match} now={now} projectOf={projectOf} onOpen={onOpen} />
      ))}
      <div style={{ padding: '6px 12px 10px', display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
        {shownPending.length ? (
          <>
            <Text type="secondary" style={{ fontSize: 11 }}>接下来（{court.pending.length} 场）</Text>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {shownPending.map((match) => (
                <NextMatch key={match.id} match={match} now={now} projectOf={projectOf} onOpen={onOpen} />
              ))}
            </div>
          </>
        ) : null}
        {expanded && court.finished.length ? (
          <>
            <Text type="secondary" style={{ fontSize: 11, marginTop: shownPending.length ? 6 : 0 }}>
              已结束（{court.finished.length} 场）
            </Text>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 420, overflowY: 'auto' }}>
              {court.finished.map((match) => (
                <FinishedMatch key={match.id} match={match} projectOf={projectOf} onOpen={onOpen} />
              ))}
            </div>
          </>
        ) : null}
        {!shownPending.length && !(expanded && court.finished.length) ? (
          <Text type="secondary" style={{ fontSize: 12 }}>
            {court.finished.length ? `还没有要打的场次，已结束 ${court.finished.length} 场` : '没有排在这片场地的场次'}
          </Text>
        ) : null}
        {canExpand ? (
          <Button
            type="link"
            size="small"
            style={{ padding: 0, height: 'auto', fontSize: 12, alignSelf: 'flex-start' }}
            icon={expanded ? <UpOutlined /> : <DownOutlined />}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded
              ? '收起'
              : `查看全部 ${court.total} 场${court.finished.length ? `（含已结束 ${court.finished.length} 场）` : ''}`}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function Section({ title, warn, children }: { title: string; warn?: boolean; children: ReactNode }) {
  return (
    <div style={{ marginTop: 16, border: `1px solid ${warn ? '#fecaca' : '#e2e8f0'}`, borderRadius: 10, background: '#fff', padding: '10px 12px' }}>
      <Text strong style={{ color: warn ? '#b91c1c' : '#334155' }}>{title}</Text>
      <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 8 }}>{children}</div>
    </div>
  );
}

function LiveMatch({ match, now, projectOf, onOpen }: { match: MMMatch; now: number; projectOf: (match: MMMatch) => string; onOpen: (id: string) => void }) {
  const noReferee = matchAttention(match, now).includes('NO_REFEREE');
  const games = scoreText(match).split(' / ');
  return (
    <button
      type="button"
      onClick={() => onOpen(match.id)}
      style={{ textAlign: 'left', border: 'none', borderBottom: '1px solid #eef2f7', background: '#fff', padding: '10px 12px', cursor: 'pointer' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <StatusTag status={match.status} />
        <Text style={{ fontSize: 12, color: '#475569' }}>{projectOf(match)} · {match.stageLabel} · 第 {match.matchNo} 场</Text>
        {match.code ? <Text strong style={{ fontSize: 12, color: '#0f4c9c' }}>{match.code}</Text> : null}
      </div>
      <TeamLine match={match} />
      <div style={{ marginTop: 6, display: 'grid', gridTemplateColumns: '1fr auto', gap: '2px 10px', alignItems: 'center' }}>
        <SideName match={match} side={1} />
        <Text strong style={{ fontFamily: 'ui-monospace, monospace', fontSize: 15 }}>{games.map((game) => game.split(':')[0]).join('  ')}</Text>
        <SideName match={match} side={2} />
        <Text strong style={{ fontFamily: 'ui-monospace, monospace', fontSize: 15 }}>{games.map((game) => game.split(':')[1] ?? '').join('  ')}</Text>
      </div>
      <div style={{ marginTop: 6, fontSize: 12, color: noReferee ? '#b91c1c' : '#64748b' }}>
        裁判 {match.referee?.username ?? '未分配'} {noReferee ? '⚠' : ''}
      </div>
    </button>
  );
}

function NextMatch({ match, now, projectOf, onOpen }: { match: MMMatch; now: number; projectOf: (match: MMMatch) => string; onOpen: (id: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(match.id)}
      style={{ textAlign: 'left', border: '1px solid #eef2f7', borderRadius: 8, background: '#fafcff', padding: '6px 8px', cursor: 'pointer' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <Text strong style={{ fontSize: 12 }}>{timeText(match.scheduledAt, false)}</Text>
        {match.code ? <Text style={{ fontSize: 12, color: '#0f4c9c' }}>{match.code}</Text> : null}
        <Text type="secondary" style={{ fontSize: 12 }}>{projectOf(match)} · {match.stageLabel}</Text>
        <AttentionTags match={match} now={now} />
      </div>
      <div style={{ fontSize: 12, color: '#334155', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {match.teamMatchId ? `${match.team1Name ?? '待定'} vs ${match.team2Name ?? '待定'} · ` : ''}
        {sideLabel(match.side1)} vs {sideLabel(match.side2)}
      </div>
      <div style={{ fontSize: 11, color: match.referee ? '#94a3b8' : '#d97706' }}>
        {match.venue ? '' : '待排场地 · '}裁判 {match.referee?.username ?? '未分配'}
      </div>
    </button>
  );
}

/** 已经打完（或已取消）的一场：灰色一行，保留时间、场次号、对阵和比分，点开还能改分改判。 */
function FinishedMatch({ match, projectOf, onOpen }: { match: MMMatch; projectOf: (match: MMMatch) => string; onOpen: (id: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(match.id)}
      style={{ textAlign: 'left', border: '1px solid #f1f5f9', borderRadius: 8, background: '#fbfcfe', padding: '5px 8px', cursor: 'pointer' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <Text type="secondary" style={{ fontSize: 11 }}>{timeText(match.scheduledAt, false)}</Text>
        {match.code ? <Text style={{ fontSize: 11, color: '#64748b' }}>{match.code}</Text> : null}
        <Text type="secondary" style={{ fontSize: 11 }}>{projectOf(match)} · {match.stageLabel}</Text>
        <StatusTag status={match.status} />
      </div>
      <div style={{ fontSize: 12, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {(match.teamMatchId ? `${match.team1Name ?? '待定'} vs ${match.team2Name ?? '待定'} · ` : '')}
        {sideLabel(match.side1)} vs {sideLabel(match.side2)}
        <span style={{ marginLeft: 8, fontFamily: 'ui-monospace, monospace', color: '#475569' }}>{scoreText(match)}</span>
      </div>
    </button>
  );
}
