'use client';

import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Empty, Modal, Popconfirm, Select, Space, Table, Tag, message } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import { apiFetch } from '@/lib/api';
import { teamFormatLabel } from './TeamCompetitionFields';

type Team = { id: string; name: string };
type Standing = { teamId: string; teamName: string; wins: number; losses: number; matchesWon: number; matchesLost: number; netMatches: number; groupRank: number | null; advanced: boolean };
type GroupMatch = { id: string; round: string; matchNo: number; status: string; team1?: Team; team2?: Team; team1Wins: number; team2Wins: number };
type Group = { id: string; groupNo: number; groupName: string; standings: Standing[]; matches: GroupMatch[] };
type GroupData = { competition: { format: string; groupCount?: number | null; advancePerGroup?: number | null }; groups: Group[] };

export default function TeamCompetitionGroups({ competitionId, token, teams, format, hasDraw, onChanged, showDraw = false }: {
  competitionId: string; token?: string; teams: Team[]; format?: string; hasDraw: boolean; onChanged: () => Promise<void>; showDraw?: boolean;
}) {
  const [data, setData] = useState<GroupData | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [assignments, setAssignments] = useState<Record<string, number>>({});
  const [error, setError] = useState('');
  const isGroup = Boolean(format && format !== 'SINGLE_ELIMINATION');
  const load = useCallback(async () => {
    if (!token || !competitionId || !isGroup) { setData(null); return; }
    setLoading(true); setError('');
    try { setData(await apiFetch<GroupData>(`/team-competitions/${competitionId}/groups`, { token })); }
    catch (err) { setError(err instanceof Error ? err.message : '加载分组失败'); }
    finally { setLoading(false); }
  }, [competitionId, token, isGroup]);
  useEffect(() => { setData(null); setEditing(false); void load(); }, [load, hasDraw, teams]);
  async function run(path: string, body: unknown, success: string, method = 'POST') {
    setBusy(true);
    try {
      await apiFetch(`/team-competitions/${competitionId}/${path}`, { method, token, body: JSON.stringify(body) });
      message.success(success); setEditing(false); await onChanged(); await load();
    } catch (err) { message.error(err instanceof Error ? err.message : '操作失败'); }
    finally { setBusy(false); }
  }
  const groups = data?.groups ?? [];
  const groupMatches = groups.flatMap(group => group.matches);
  const completed = groupMatches.length > 0 && groupMatches.every(match => match.status === 'COMPLETED');
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
  if (!isGroup && !showDraw) return null;
  return <Card loading={loading} title={isGroup ? '小组分组与积分榜' : '团体赛抽签'} extra={<Space wrap>
    {showDraw && <Button type="primary" disabled={hasDraw || teams.length < 2} loading={busy} onClick={() => run('draw', { force: false }, '团体对阵已生成')}>生成团体对阵</Button>}
    {showDraw && hasDraw && <Button danger disabled={busy} onClick={() => Modal.confirm({ title: '重新抽签？', content: '将清除已有对阵和赛前名单。已有子项开赛时不能重新生成。', okText: '重新生成', cancelText: '取消', onOk: () => run('draw', { force: true }, '团体对阵已重新生成') })}>重新抽签</Button>}
    {showDraw && hasDraw && <Popconfirm title="清空该团体赛的抽签、对阵与比赛结果并取消公开（队伍名单保留），且无法撤销，确认继续？" description="已有子项开赛或产生比分时不能直接取消，需到团体赛详情提交取消申请，由超级管理员审批。" okText="清空" cancelText="取消" onConfirm={() => run('draw/clear', {}, '已取消团体对阵，可调整队伍后重新生成')}><Button danger icon={<DeleteOutlined />} disabled={busy}>取消对阵</Button></Popconfirm>}
    {groups.length > 0 && !editing && <Button disabled={busy} onClick={startEditing}>手动调整分组</Button>}
    <Button onClick={load} disabled={busy}>刷新分组</Button>
  </Space>}>
    {error && <Alert type="error" showIcon title={error} style={{ marginBottom: 12 }} />}
    {isGroup && <Alert type="info" showIcon title={`${teamFormatLabel(format)} · ${data?.competition.groupCount ?? groups.length} 组${format === 'GROUP_PLUS_KNOCKOUT' ? ` · 每组晋级 ${data?.competition.advancePerGroup ?? 2} 队` : ''}`} description="积分榜显示团体胜负场及子项胜负。小组排名和晋级资格以比赛结果为准。" style={{ marginBottom: 16 }} />}
    {editing && <Space orientation="vertical" style={{ width: '100%', marginBottom: 16 }}>
      <Alert type="warning" title="移动队伍后，保存会重新生成小组对阵及名单。每支队伍必须且只能属于一个小组。" />
      <Table rowKey="id" size="small" pagination={false} dataSource={teams} columns={[
        { title: '队伍', dataIndex: 'name' },
        { title: '分组', render: (_, team: Team) => <Select aria-label={`${team.name}分组`} style={{ width: 160 }} value={assignments[team.id]} options={groups.map(group => ({ value: group.groupNo, label: group.groupName }))} onChange={groupNo => setAssignments(current => ({ ...current, [team.id]: groupNo }))} /> },
      ]} />
      <Space><Button type="primary" loading={busy} onClick={saveGroups}>保存分组并重新生成</Button><Button disabled={busy} onClick={() => setEditing(false)}>取消调整</Button></Space>
    </Space>}
    {isGroup && !groups.length && !error && <Empty description="尚未生成小组，请先生成团体对阵" />}
    <Space orientation="vertical" size={16} style={{ width: '100%' }}>{groups.map(group => <Card key={group.id} size="small" title={group.groupName}>
      <Table<Standing> rowKey="teamId" size="small" pagination={false} dataSource={[...group.standings].sort((a, b) => (a.groupRank ?? 999) - (b.groupRank ?? 999))} scroll={{ x: 620 }} columns={[
        { title: '排名', dataIndex: 'groupRank', render: value => value || '-' }, { title: '队伍', dataIndex: 'teamName' },
        { title: '胜场', dataIndex: 'wins' }, { title: '负场', dataIndex: 'losses' },
        { title: '胜项', dataIndex: 'matchesWon' }, { title: '负项', dataIndex: 'matchesLost' }, { title: '净胜项', dataIndex: 'netMatches' },
        ...(format === 'GROUP_PLUS_KNOCKOUT' ? [{ title: '晋级', render: (_: unknown, row: Standing) => row.advanced ? <Tag color="green">已晋级</Tag> : <Tag>待定</Tag> }] : []),
      ]} />
      <Table<GroupMatch> rowKey="id" size="small" pagination={false} dataSource={group.matches} style={{ marginTop: 12 }} scroll={{ x: 500 }} columns={[
        { title: '小组场次', render: (_, match) => `${match.round} / ${match.matchNo}` },
        { title: '对阵', render: (_, match) => `${match.team1?.name ?? '待定'} VS ${match.team2?.name ?? '待定'}` },
        { title: '总比分', render: (_, match) => `${match.team1Wins} : ${match.team2Wins}` },
        { title: '状态', dataIndex: 'status', render: value => ({ PENDING: '未开始', LIVE: '进行中', COMPLETED: '已结束', CANCELLED: '无需比赛' }[value as string] ?? value) },
      ]} />
    </Card>)}</Space>
    {format === 'GROUP_PLUS_KNOCKOUT' && groups.length > 0 && <Space orientation="vertical" style={{ marginTop: 16 }}>
      {!completed && <Alert type="info" title="全部小组赛结束后，可按小组名次生成淘汰赛。" />}
      <Button type="primary" disabled={!completed} loading={busy} onClick={() => Modal.confirm({ title: '按小组排名生成淘汰赛？', content: '将使用每组达到晋级名次的队伍生成淘汰赛对阵。', okText: '生成淘汰赛', cancelText: '取消', onOk: () => run('knockout', { force: false }, '淘汰赛对阵已生成') })}>小组赛后生成淘汰赛</Button>
    </Space>}
  </Card>;
}
