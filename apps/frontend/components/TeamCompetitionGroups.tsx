'use client';

import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, DatePicker, Empty, Form, Modal, Select, Space, Table, Tag, Typography, message } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { apiFetch } from '@/lib/api';
import { useCurrentAccess } from '@/lib/use-current-role';
import { teamFormatLabel } from './TeamCompetitionFields';
import TeamDrawActions from './TeamDrawActions';
import TeamEncounterTable, { type TeamEncounter, type TeamEncounterChild } from './TeamEncounterTable';

type Team = { id: string; name: string };
type Standing = { teamId: string; teamName: string; wins: number; losses: number; matchesWon: number; matchesLost: number; netMatches: number; groupRank: number | null; advanced: boolean };
type Group = { id: string; groupNo: number; groupName: string; standings: Standing[]; matches: TeamEncounter[] };
type GroupData = { competition: { tournamentId: string; format: string; groupCount?: number | null; advancePerGroup?: number | null; winThreshold?: number; playAllMatches?: boolean }; groups: Group[]; knockout?: TeamEncounter[] };
type ScheduleTarget = { encounter: TeamEncounter; child: TeamEncounterChild };

/** 抽签编排页在比赛进行中保持打开，15 秒拉取一次即可看到每个子项的最新局分。 */
const LIVE_REFRESH_MS = 15000;

export default function TeamCompetitionGroups({ competitionId, token, teams, format, hasDraw, onChanged, showDraw = false }: {
  competitionId: string; token?: string; teams: Team[]; format?: string; hasDraw: boolean; onChanged: () => Promise<void>; showDraw?: boolean;
}) {
  const [data, setData] = useState<GroupData | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [assignments, setAssignments] = useState<Record<string, number>>({});
  const [error, setError] = useState('');
  const access = useCurrentAccess();
  const [scheduleForm] = Form.useForm();
  const [editingSchedule, setEditingSchedule] = useState<ScheduleTarget | null>(null);
  const [venues, setVenues] = useState<Array<{ id: string; name: string; isActive: boolean }>>([]);
  const isGroup = Boolean(format && format !== 'SINGLE_ELIMINATION');
  const enabled = Boolean(token && competitionId && (isGroup || showDraw));
  const load = useCallback(async (silent = false) => {
    if (!enabled) { setData(null); return; }
    if (!silent) setLoading(true);
    try {
      const next = await apiFetch<GroupData>(`/team-competitions/${competitionId}/groups`, { token });
      setData(next);
      setError('');
    } catch (err) {
      if (!silent) setError(err instanceof Error ? err.message : '加载分组失败');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [competitionId, token, enabled]);
  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      setData(null); setEditing(false); void load();
    });
    return () => { cancelled = true; };
  }, [load, hasDraw, teams]);
  // 比赛进行中无需手动刷新：页面可见时定时拉取，切回标签页也会立即刷新一次。
  useEffect(() => {
    if (!enabled) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load(true);
    }, LIVE_REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load(true);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, load]);
  async function run(path: string, body: unknown, success: string, method = 'POST') {
    setBusy(true);
    try {
      await apiFetch(`/team-competitions/${competitionId}/${path}`, { method, token, body: JSON.stringify(body) });
      message.success(success); setEditing(false); await onChanged(); await load();
    } catch (err) { message.error(err instanceof Error ? err.message : '操作失败'); }
    finally { setBusy(false); }
  }
  const groups = data?.groups ?? [];
  const knockout = data?.knockout ?? [];
  const groupMatches = groups.flatMap(group => group.matches);
  const completed = groupMatches.length > 0 && groupMatches.every(match => match.status === 'COMPLETED');
  const playAllMatches = data?.competition.playAllMatches ?? false;
  const cancelledChildren = groupMatches.reduce(
    (total, match) =>
      total + match.children.filter(child => child.status === 'CANCELLED' && !(child.games?.length ?? 0)).length,
    0,
  );
  const showPlayAllHint = isGroup && cancelledChildren > 0;
  async function restoreCancelledChildren() {
    setBusy(true);
    try {
      const result = await apiFetch<{ reopenedChildren?: number }>(`/team-competitions/${competitionId}`, {
        method: 'PATCH',
        token,
        // 未开启时顺带开启“打满所有子项”；已开启时只恢复历史取消的剩余子项。
        body: JSON.stringify(playAllMatches ? { reopenCancelledChildren: true } : { playAllMatches: true }),
      });
      message.success(
        result.reopenedChildren
          ? `已恢复 ${result.reopenedChildren} 个剩余子项，可继续补录比分`
          : '没有可恢复的剩余子项',
      );
      await load();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '恢复失败');
    } finally {
      setBusy(false);
    }
  }
  function startEditing() {
    setAssignments(Object.fromEntries(groups.flatMap(group => group.standings.map(team => [team.teamId, group.groupNo]))));
    setEditing(true);
  }
  function saveGroups() {
    const payload = groups.map(group => ({ groupNo: group.groupNo, teamIds: teams.filter(team => assignments[team.id] === group.groupNo).map(team => team.id) }));
    if (teams.some(team => !assignments[team.id])) { message.error('请为所有队伍选择小组'); return; }
    if (payload.some(group => group.teamIds.length < 2)) { message.error('每组至少需要 2 支队伍'); return; }
    if (format === 'GROUP_PLUS_KNOCKOUT' && payload.some(group => group.teamIds.length < (data?.competition.advancePerGroup ?? 2))) { message.error('每组队数不能少于晋级队数'); return; }
    Modal.confirm({ title: '保存分组并重新生成小组对阵？', content: '现有小组对阵和赛前名单将重建。已有比赛开赛时，服务器会拒绝调整。', okText: '保存并重新生成', cancelText: '取消', onOk: () => run('groups/adjust', { groups: payload }, '分组已保存，小组对阵已重新生成', 'PATCH') });
  }
  async function openSchedule(encounter: TeamEncounter) {
    const child = encounter.children.find(match => match.status === 'PENDING');
    if (!child || !data) return;
    setBusy(true);
    try {
      setVenues(await apiFetch(`/tournaments/${data.competition.tournamentId}/venues`, { token }));
      scheduleForm.setFieldsValue({ venueId: child.venue?.id, scheduledAt: child.scheduledAt ? dayjs(child.scheduledAt) : null });
      setEditingSchedule({ encounter, child });
    } catch (err) { message.error(err instanceof Error ? err.message : '加载场地失败'); }
    finally { setBusy(false); }
  }
  async function saveSchedule(values: { venueId: string; scheduledAt: Dayjs }) {
    if (!editingSchedule) return;
    setBusy(true);
    try {
      const result = await apiFetch<{ conflicts: Array<unknown> }>(`/matches/${editingSchedule.child.id}/schedule`, {
        method: 'PATCH', token, body: JSON.stringify({ venueId: values.venueId,
          scheduledAt: values.scheduledAt.toISOString(), scheduledAtLocal: values.scheduledAt.format('YYYY-MM-DD HH:mm') }),
      });
      setEditingSchedule(null);
      if (result.conflicts.length) message.warning('排程已保存，存在冲突，请到场地自动排程查看并处理');
      else message.success('本场团体对阵的场地与时间已更新');
      await load();
    } catch (err) { message.error(err instanceof Error ? err.message : '调整排程失败'); }
    finally { setBusy(false); }
  }
  if (!isGroup && !showDraw) return null;
  return <Card loading={loading} title={<div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingBlock: 12 }}>
    <span>{isGroup ? '小组分组与积分榜' : '团体赛抽签'}</span><Space wrap>
    {showDraw && <Button type="primary" disabled={hasDraw || teams.length < 2} loading={busy} onClick={() => run('draw', { force: false }, '团体对阵已生成')}>生成团体对阵</Button>}
    {showDraw && hasDraw && <Button danger disabled={busy} onClick={() => Modal.confirm({ title: '重新抽签？', content: '将清除已有对阵和赛前名单。已有子项开赛时不能重新生成。', okText: '重新生成', cancelText: '取消', onOk: () => run('draw', { force: true }, '团体对阵已重新生成') })}>重新抽签</Button>}
    {groups.length > 0 && format !== 'ROUND_ROBIN' && !editing && <Button disabled={busy} onClick={startEditing}>手动调整分组</Button>}
    <Button onClick={() => load()} disabled={busy}>刷新分组</Button>
  </Space></div>}>
    {showDraw && hasDraw && <div style={{ marginBottom: 16 }}><TeamDrawActions key={competitionId} competitionId={competitionId} token={token} hasDraw={hasDraw} disabled={busy} revision={data} onChanged={async () => { await onChanged(); await load(); }} /></div>}
    {error && <Alert type="error" showIcon title={error} style={{ marginBottom: 12 }} />}
    {isGroup && <Alert type="info" showIcon title={`${teamFormatLabel(format)} · ${data?.competition.groupCount ?? groups.length} 组${format === 'GROUP_PLUS_KNOCKOUT' ? ` · 每组晋级 ${data?.competition.advancePerGroup ?? 2} 队` : ''}`} description={format === 'ROUND_ROBIN' ? '全部团体在同一组，每两队交手一次，全部打完即结束比赛并确定各队名次。胜场为赢下的团体对阵数；胜次为正式子项获胜数；净胜分为正式子项每局得分减失分的合计。排名依次比较胜场、胜次、净胜分、两队相互胜负；仍无法区分时并列。各子项双方名单填齐并锁定后，才会显示在裁判端。' : '排名依次比较胜场（赢下团体对阵数）、胜次（正式子项获胜数）、净胜分（正式子项逐局得分减失分的合计）。补打不计入胜次和净胜分。'} style={{ marginBottom: 16 }} />}
    {isGroup && <Alert type="success" showIcon title="每个子项的出场名单和每局比分都会显示在对阵下方，比赛进行中自动刷新。" description={`先赢 ${data?.competition.winThreshold ?? '规定'} 场时即计入胜场和排名；胜次、净胜分只统计到胜负确定的那一场，之后的补打只保留比分，不计排名。`} style={{ marginBottom: 16 }} />}
    {showPlayAllHint && (
      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: 16 }}
        title={`有 ${cancelledChildren} 个剩余子项被标记为「无需比赛」`}
        description={
          playAllMatches
            ? '这些子项在更早的规则下被取消。恢复后可继续补录比分（已生成淘汰赛对阵时不会恢复）。'
            : '当前未开启「胜负确定后继续比赛」，所以团体对阵达到胜场数后剩余子项被取消、无法补录。恢复时会一并开启该选项，并把尚未开赛的剩余子项恢复为「未开始」。'
        }
        action={
          <Button
            size="small"
            type="primary"
            loading={busy}
            onClick={() =>
              Modal.confirm({
                title: playAllMatches ? '恢复剩余子项？' : '开启「胜负确定后继续比赛」并恢复？',
                content: '将把因胜负已定取消、且尚未开赛的剩余子项恢复为未开始，可继续补录比分。已生成淘汰赛对阵时不会恢复。',
                okText: '恢复剩余子项',
                cancelText: '取消',
                onOk: restoreCancelledChildren,
              })
            }
          >
            {playAllMatches ? '恢复剩余子项' : '开启打满并恢复'}
          </Button>
        }
      />
    )}
    {!isGroup && showDraw && <Alert type="success" showIcon title="团体对阵按轮次列出，展开即可看到每个子项的出场名单与每局比分；比赛进行中自动刷新。" style={{ marginBottom: 16 }} />}
    {editing && <Space orientation="vertical" style={{ width: '100%', marginBottom: 16 }}>
      <Alert type="warning" title="移动队伍后，保存会重新生成小组对阵及名单。每支队伍必须且只能属于一个小组。" />
      <Table rowKey="id" size="small" pagination={false} dataSource={teams} columns={[
        { title: '队伍', dataIndex: 'name' },
        { title: '分组', render: (_, team: Team) => <Select aria-label={`${team.name}分组`} style={{ width: 160 }} value={assignments[team.id]} options={groups.map(group => ({ value: group.groupNo, label: group.groupName }))} onChange={groupNo => setAssignments(current => ({ ...current, [team.id]: groupNo }))} /> },
      ]} />
      <Space><Button type="primary" loading={busy} onClick={saveGroups}>保存分组并重新生成</Button><Button disabled={busy} onClick={() => setEditing(false)}>取消调整</Button></Space>
    </Space>}
    {isGroup && !groups.length && !error && !knockout.length && <Empty description="尚未生成小组，请先生成团体对阵" />}
    <Space orientation="vertical" size={16} style={{ width: '100%' }}>{groups.map(group => <Card key={group.id} size="small" title={group.groupName}>
      <Table<Standing> rowKey="teamId" size="small" pagination={false} dataSource={[...group.standings].sort((a, b) => (a.groupRank ?? 999) - (b.groupRank ?? 999))} scroll={{ x: 620 }} columns={[
        { title: '排名', dataIndex: 'groupRank', render: value => value || '-' }, { title: '队伍', dataIndex: 'teamName' },
        { title: '胜场', dataIndex: 'wins' }, { title: '胜次', dataIndex: 'matchesWon' }, { title: '净胜分', dataIndex: 'netMatches' },
        ...(format === 'GROUP_PLUS_KNOCKOUT' ? [{ title: '晋级', render: (_: unknown, row: Standing) => row.advanced ? <Tag color="green">已晋级</Tag> : <Tag>待定</Tag> }] : []),
      ]} />
      <div style={{ marginTop: 12 }}>
        <TeamEncounterTable encounters={group.matches} busy={busy} showRound={false} canSchedule={access.can('SCHEDULING')} onSchedule={openSchedule} />
      </div>
    </Card>)}</Space>
    {knockout.length > 0 && <Card size="small" title="淘汰赛对阵" style={{ marginTop: 16 }}>
      <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
        每一轮对阵结束后，胜方会自动进入下一轮；展开任意一场可查看每个子项的出场名单和每局比分。
      </Typography.Text>
      <TeamEncounterTable encounters={knockout} busy={busy} canSchedule={access.can('SCHEDULING')} onSchedule={openSchedule} />
    </Card>}
    <Modal title="调整团体对阵场地与时间" open={Boolean(editingSchedule)} onCancel={() => setEditingSchedule(null)} onOk={() => scheduleForm.submit()} confirmLoading={busy} okText="保存排程" cancelText="取消" forceRender>
      <Alert type="info" showIcon style={{ marginBottom: 16 }} title={`${editingSchedule?.encounter.team1?.name ?? ''} VS ${editingSchedule?.encounter.team2?.name ?? ''}`} description="可选择保留的空闲场地。本场团体对阵的所有未开始子项会使用同一场地，按顺序接续比赛；已有子项开赛后不能更换场地。重新自动排程会重排未开始场次。" />
      <Form form={scheduleForm} layout="vertical" onFinish={saveSchedule}>
        <Form.Item name="venueId" label="场地" rules={[{ required: true, message: '请选择场地' }]}><Select options={venues.filter(venue => venue.isActive).map(venue => ({ value: venue.id, label: venue.name }))} /></Form.Item>
        <Form.Item name="scheduledAt" label="第一个未开始子项的开始时间" rules={[{ required: true, message: '请选择开始时间' }]}><DatePicker showTime format="YYYY-MM-DD HH:mm" style={{ width: '100%' }} /></Form.Item>
      </Form>
    </Modal>
    {format === 'GROUP_PLUS_KNOCKOUT' && groups.length > 0 && !knockout.length && <Space orientation="vertical" style={{ marginTop: 16 }}>
      {!completed && <Alert type="info" title="全部小组赛结束后，可按小组名次生成淘汰赛。" />}
      <Button type="primary" disabled={!completed} loading={busy} onClick={() => Modal.confirm({ title: '按小组排名生成淘汰赛？', content: '将使用每组达到晋级名次的队伍生成淘汰赛对阵。', okText: '生成淘汰赛', cancelText: '取消', onOk: () => run('knockout', { force: false }, '淘汰赛对阵已生成') })}>小组赛后生成淘汰赛</Button>
    </Space>}
  </Card>;
}
