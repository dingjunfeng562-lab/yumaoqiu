'use client';

import type { ReactNode } from 'react';
import { Card, Empty, Typography } from 'antd';
import { WarningFilled } from '@ant-design/icons';
import { matchAttention, sideLabel, type CourtBoard as CourtBoardData, type MMMatch } from '@/lib/match-management';
import { AttentionTags, SideName, StatusTag, TeamLine, scoreText, timeText } from './display';

const { Text } = Typography;

/**
 * 场地视图（比赛当天的现场控制台）：每片场地一张卡，最上面是正在打的（比分、裁判），
 * 下面按时间列出这片场地上**全部**还没打的场次（卡片内滚动），不再只显示接下来两场。
 * 进行中却没有场地的、还没排场地或时间的单独列在最后。点任意一场打开管理。
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
  if (!board.courts.length && !board.liveWithoutVenue.length && !board.unscheduled.length) {
    return (
      <Card style={{ marginTop: 16 }}>
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="这个赛事还没有场地，或者当前筛选下没有场次" />
      </Card>
    );
  }
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
        {board.courts.map((court) => {
          const busy = court.live.length > 0;
          return (
            <div
              key={court.venue.id}
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
                  {busy ? '比赛中' : '空闲'} · 待打 {court.remaining}
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
                <Text type="secondary" style={{ fontSize: 11 }}>
                  接下来{court.pending.length ? `（${court.pending.length} 场）` : ''}
                </Text>
                {court.pending.length ? (
                  // 这片场地当天所有场次都列出来，超出高度在卡片内滚动，避免把后面的场次藏起来。
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 420, overflowY: 'auto', paddingRight: 2 }}>
                    {court.pending.map((match) => (
                      <NextMatch key={match.id} match={match} now={now} projectOf={projectOf} onOpen={onOpen} />
                    ))}
                  </div>
                ) : <Text type="secondary" style={{ fontSize: 12 }}>没有排在这片场地的场次</Text>}
              </div>
            </div>
          );
        })}
      </div>

      {board.liveWithoutVenue.length ? (
        <Section title={`进行中但没有场地（${board.liveWithoutVenue.length}）`} warn>
          {board.liveWithoutVenue.map((match) => <NextMatch key={match.id} match={match} now={now} projectOf={projectOf} onOpen={onOpen} />)}
        </Section>
      ) : null}
      {board.unscheduled.length ? (
        <div style={{ marginTop: 16, border: '1px solid #e2e8f0', borderRadius: 10, background: '#fff', padding: '10px 12px' }}>
          <Text strong style={{ color: '#334155' }}>还没排场地或时间（{board.unscheduled.length}）</Text>
          {/* 全部列出来（原来只显示前 40 场），超出高度在区块内滚动，不再把后面的场次藏起来。 */}
          <div style={{ marginTop: 8, maxHeight: 640, overflowY: 'auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 8 }}>
            {board.unscheduled.map((match) => <NextMatch key={match.id} match={match} now={now} projectOf={projectOf} onOpen={onOpen} />)}
          </div>
        </div>
      ) : null}
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
