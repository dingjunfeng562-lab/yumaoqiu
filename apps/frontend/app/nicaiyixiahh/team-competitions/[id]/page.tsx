'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Alert, Button, Card, Form, Input, Modal, Select, Space, Table, Tag, Typography, message } from 'antd';
import { PlusOutlined, ReloadOutlined, SettingOutlined } from '@ant-design/icons';
import { apiFetch } from '@/lib/api';
import TeamCompetitionFields, { TEAM_SCORING_OPTIONS, teamDefaults } from '@/components/TeamCompetitionFields';
import TeamRosterImportModal from '@/components/TeamRosterImport';

type Player = { id: string; name: string; gender: 'MALE' | 'FEMALE'; affiliation: string };
type Team = { id: string; name: string; affiliation: string; memberCount: number; members: Player[]; rosterOverrideConfirmed?: boolean };
type Item = { id: string; eventType: string; eventTypeLabel: string; sortOrder: number };
type Lineup = { teamId: string; teamCompetitionItemId: string; player1: Player; player2?: Player | null; name: string };
type ChildMatch = { id: string; teamCompetitionItemId: string; matchNo: number; status: string; lineupLocked: boolean; eventTypeLabel: string; referee?: { username: string }; venue?: { name: string }; games: Array<{ side1Score: number; side2Score: number }> };
type Encounter = { id: string; round: string; matchNo: number; status: string; team1?: { id: string; name: string }; team2?: { id: string; name: string }; team1Wins: number; team2Wins: number; winnerTeamName?: string; matches: ChildMatch[]; lineups: Lineup[] };
type Competition = { id: string; name: string; description?: string; winThreshold: number; malePlayerCount: number | null; femalePlayerCount: number | null; scoringRule: string; scoringMode: string; customGamePoint: number | null; customGameCap: number | null; customGamesToWin: number | null; isPublished: boolean; items: Item[]; teams: Team[]; teamMatches: Encounter[] };
type Selection = { teamId: string; teamCompetitionItemId: string; player1Id: string; player2Id?: string };
const statusLabel: Record<string, string> = { PENDING: '未开始', LIVE: '进行中', COMPLETED: '已结束', CANCELLED: '无需比赛' };
const doubles = (type: string) => type.endsWith('DOUBLES');

export default function TeamCompetitionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: session } = useSession();
  const token = session?.user?.accessToken;
  const [competition, setCompetition] = useState<Competition | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [teamOpen, setTeamOpen] = useState(false);
  const [editingTeam, setEditingTeam] = useState<Team | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [addingToTeam, setAddingToTeam] = useState<Team | null>(null);
  const [lineupOverride, setLineupOverride] = useState(false);
  const [active, setActive] = useState<{ encounter: Encounter; match: ChildMatch; item: Item } | null>(null);
  const [settingsForm] = Form.useForm();
  const [teamForm] = Form.useForm();
  const [importForm] = Form.useForm();
  const [lineupForm] = Form.useForm();
  const selectedIds: string[] = Form.useWatch('playerIds', teamForm) ?? [];
  const selections: Selection[] = Form.useWatch('selections', lineupForm) ?? [];

  const loadData = useCallback(async () => {
    if (!token || !id) return;
    setLoading(true);
    try {
      const [detail, available] = await Promise.all([
        apiFetch<Competition>(`/team-competitions/${id}`, { token }),
        apiFetch<Player[]>(`/team-competitions/${id}/available-players`, { token }),
      ]);
      setCompetition(detail); setPlayers(available);
    } catch (error) { message.error(error instanceof Error ? error.message : '加载失败'); }
    finally { setLoading(false); }
  }, [id, token]);
  useEffect(() => {
    const timer = window.setTimeout(() => { void loadData(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadData]);

  async function submit(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try { await action(); }
    catch (error) {
      if (!(error && typeof error === 'object' && 'errorFields' in error)) message.error(error instanceof Error ? error.message : '操作失败');
    } finally { setBusy(false); }
  }
  function openSettings() {
    settingsForm.setFieldsValue({ ...teamDefaults, ...competition, malePlayerCount: competition?.malePlayerCount ?? 5, femalePlayerCount: competition?.femalePlayerCount ?? 5 });
    setSettingsOpen(true);
  }
  async function saveSettings() {
    const values = await settingsForm.validateFields();
    await apiFetch(`/team-competitions/${id}`, { method: 'PATCH', token, body: JSON.stringify({
      name: values.name, description: values.description, malePlayerCount: values.malePlayerCount, femalePlayerCount: values.femalePlayerCount,
      winThreshold: values.winThreshold, isPublished: values.isPublished, scoringRule: values.scoringRule, scoringMode: values.scoringMode,
      customGamePoint: values.customGamePoint ?? null, customGameCap: values.customGameCap ?? null, customGamesToWin: values.customGamesToWin ?? null,
      items: values.items.map((item: Item, index: number) => ({ eventType: item.eventType, sortOrder: index + 1 })),
    }) });
    setSettingsOpen(false); message.success('团体赛配置已保存'); await loadData();
  }
  function openTeam(team?: Team) {
    setEditingTeam(team ?? null); teamForm.resetFields();
    if (team) teamForm.setFieldsValue({ name: team.name, affiliation: team.affiliation, playerIds: team.members.map(p => p.id) });
    setTeamOpen(true);
  }
  async function saveTeam() {
    const values = await teamForm.validateFields();
    if (editingTeam) {
      await apiFetch(`/team-competitions/teams/${editingTeam.id}/members`, { method: 'PUT', token, body: JSON.stringify({ playerIds: values.playerIds, overrideConfirmed: true }) });
      await apiFetch(`/team-competitions/teams/${editingTeam.id}`, { method: 'PATCH', token, body: JSON.stringify({ name: values.name, affiliation: values.affiliation }) });
    } else await apiFetch(`/team-competitions/${id}/teams`, { method: 'POST', token, body: JSON.stringify(values) });
    setTeamOpen(false); message.success('队伍已保存'); await loadData();
  }
  async function importTeam() {
    const values = await importForm.validateFields();
    const rows = String(values.playersText).split(/\r?\n/).map(row => row.trim()).filter(Boolean);
    const members = rows.map((row, index) => {
      const [name, gender, affiliation, contact] = row.split(/[，,\t]/).map(value => value.trim());
      if (!name || !['男', '女', 'MALE', 'FEMALE'].includes(gender)) throw new Error(`第 ${index + 1} 行请填写姓名和明确的性别（男/女）`);
      return { name, gender: ['女', 'FEMALE'].includes(gender) ? 'FEMALE' : 'MALE', affiliation: affiliation || values.affiliation, contact };
    });
    if (addingToTeam) {
      await apiFetch(`/team-competitions/teams/${addingToTeam.id}/players`, { method: 'POST', token, body: JSON.stringify({ players: members, overrideConfirmed: true }) });
    } else {
      await apiFetch(`/team-competitions/${id}/teams/import`, { method: 'POST', token, body: JSON.stringify({ teamName: values.teamName, affiliation: values.affiliation, players: members }) });
    }
    setImportOpen(false); importForm.resetFields(); message.success('队员已导入'); await loadData();
  }
  async function draw(force: boolean) {
    await apiFetch(`/team-competitions/${id}/draw`, { method: 'POST', token, body: JSON.stringify({ force }) });
    message.success('对阵已生成，请逐项填报出场名单'); await loadData();
  }
  function openLineup(encounter: Encounter, match: ChildMatch) {
    setLineupOverride(false);
    const item = competition?.items.find(i => i.id === match.teamCompetitionItemId);
    if (!item) return;
    const rows = [encounter.team1, encounter.team2].filter(Boolean).map(team => {
      const saved = encounter.lineups.find(row => row.teamId === team!.id && row.teamCompetitionItemId === item.id);
      return { teamId: team!.id, teamCompetitionItemId: item.id, player1Id: saved?.player1.id, player2Id: saved?.player2?.id };
    });
    lineupForm.resetFields(); lineupForm.setFieldsValue({ selections: rows }); setActive({ encounter, match, item });
  }
  async function saveLineup(lock: boolean) {
    if (!active) return;
    const values = await lineupForm.validateFields();
    await apiFetch(`/team-competitions/team-matches/${active.encounter.id}/lineups`, { method: 'PUT', token, body: JSON.stringify({ selections: values.selections, lock, overrideConfirmed: lineupOverride }) });
    setActive(null); message.success(lock ? '本项双方名单已锁定' : '本项名单已保存，开赛前请锁定'); await loadData();
  }
  if (!competition) return <Card loading={loading}><Button onClick={loadData}>重新加载</Button></Card>;
  const rosterReady = competition.malePlayerCount != null && competition.femalePlayerCount != null;
  const hasDraw = competition.teamMatches.length > 0;
  const rosterText = rosterReady ? `每队 ${competition.malePlayerCount! + competition.femalePlayerCount!} 人（${competition.malePlayerCount} 男 ${competition.femalePlayerCount} 女）` : '尚未设置每队人数';
  const activeFinal = Boolean(active && (['COMPLETED', 'CANCELLED'].includes(active.match.status) || ['COMPLETED', 'CANCELLED'].includes(active.encounter.status)));
  const activeReadonly = activeFinal || Boolean(active && !lineupOverride && (active.match.lineupLocked || active.match.status !== 'PENDING'));
  const taken = new Set(competition.teams.filter(team => team.id !== editingTeam?.id).flatMap(team => team.members.map(p => p.id)));
  const selected = players.filter(p => selectedIds.includes(p.id));
  const ruleText = competition.customGamePoint
    ? `${competition.customGamePoint} 分，先赢 ${competition.customGamesToWin ?? (competition.scoringRule === 'FIFTEEN_ONE' ? 1 : 2)} 局`
    : TEAM_SCORING_OPTIONS.find(rule => rule.value === competition.scoringRule)?.label;
  const lineupNames = (encounter: Encounter, match: ChildMatch, teamId?: string) => encounter.lineups.find(row => row.teamId === teamId && row.teamCompetitionItemId === match.teamCompetitionItemId)?.name ?? '待填报';

  return <Space orientation="vertical" size={16} style={{ width: '100%' }}>
    <Space wrap style={{ justifyContent: 'space-between', width: '100%' }}>
      <div><Typography.Title level={3} style={{ margin: 0 }}>{competition.name}</Typography.Title><Typography.Text type="secondary">{rosterText} · 团体先赢 {competition.winThreshold} 项 · 子项 {ruleText}</Typography.Text></div>
      <Space wrap>
        <Button icon={<ReloadOutlined />} onClick={loadData} loading={loading}>刷新</Button>
        <Button icon={<SettingOutlined />} onClick={openSettings}>团体赛设置</Button>
        <Button type="primary" disabled={hasDraw || !rosterReady} loading={busy} onClick={() => submit(() => draw(false))}>生成对阵</Button>
        {hasDraw && <Button danger onClick={() => Modal.confirm({ title: '重新生成对阵？', content: '将清除已有对阵和赛前名单。已有子项开赛时不能重新生成。', okText: '重新生成', cancelText: '取消', onOk: () => submit(() => draw(true)) })}>重新生成</Button>}
      </Space>
    </Space>
    <Alert type="info" showIcon title="各子项赛前独立填报名单并锁定，按顺序开赛；达到团体胜场数后其余子项无需比赛。下一轮可重新安排选手。" />
    {!rosterReady && <Alert type="warning" showIcon title="请先在团体赛设置中填写每队男、女人数。" />}
    <Card title="项目出场顺序"><Space wrap>{competition.items.map(item => <Tag key={item.id} color="blue">{item.sortOrder}. {item.eventTypeLabel}</Tag>)}</Space></Card>
    <Card title={<div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingBlock: 12 }}><span>队伍与队员</span><Space wrap><Button icon={<PlusOutlined />} disabled={hasDraw || !rosterReady} onClick={() => openTeam()}>从选手库建队</Button><Button disabled={hasDraw || !rosterReady} onClick={() => setBatchOpen(true)}>批量导入团体队员</Button></Space></div>}>
      <Table rowKey="id" dataSource={competition.teams} pagination={false} scroll={{ x: 650 }} columns={[
        { title: '队伍', dataIndex: 'name' }, { title: '单位', dataIndex: 'affiliation' },
        { title: '队员人数', render: (_, team: Team) => `${team.memberCount} 人（${team.members.filter(p => p.gender === 'MALE').length} 男 ${team.members.filter(p => p.gender === 'FEMALE').length} 女）` },
        { title: '操作', render: (_, team: Team) => <Space wrap><Button onClick={() => openTeam(team)}>例外调整队员</Button><Button onClick={() => { setAddingToTeam(team); importForm.resetFields(); importForm.setFieldsValue({ teamName: team.name, affiliation: team.affiliation }); setImportOpen(true); }}>例外补充队员</Button>{team.rosterOverrideConfirmed && <Tag color="orange">名单有例外调整</Tag>}</Space> },
      ]} expandable={{ expandedRowRender: team => team.members.map(p => `${p.name}（${p.gender === 'MALE' ? '男' : '女'}）`).join('、') }} />
    </Card>
    <Card title="团体赛对阵与出场名单">
      <Table rowKey="id" dataSource={competition.teamMatches} pagination={false} scroll={{ x: 700 }} columns={[
        { title: '轮次', render: (_, row: Encounter) => `${row.round} / 第 ${row.matchNo} 场` },
        { title: '对阵', render: (_, row: Encounter) => `${row.team1?.name ?? '待定'} VS ${row.team2?.name ?? (row.status === 'COMPLETED' ? '轮空' : '待定')}` },
        { title: '总比分', render: (_, row: Encounter) => `${row.team1Wins} : ${row.team2Wins}` },
        { title: '状态', render: (_, row: Encounter) => <Tag color={row.status === 'LIVE' ? 'blue' : undefined}>{statusLabel[row.status] ?? row.status}</Tag> },
        { title: '胜方', dataIndex: 'winnerTeamName', render: value => value || '-' },
      ]} expandable={{ defaultExpandAllRows: true, expandedRowRender: encounter => <Table rowKey="id" size="small" dataSource={encounter.matches} pagination={false} columns={[
        { title: '出场顺序', render: (_, match: ChildMatch) => `${match.matchNo}. ${match.eventTypeLabel}` },
        { title: encounter.team1?.name ?? '队伍一', render: (_, match: ChildMatch) => lineupNames(encounter, match, encounter.team1?.id) },
        { title: encounter.team2?.name ?? '队伍二', render: (_, match: ChildMatch) => lineupNames(encounter, match, encounter.team2?.id) },
        { title: '状态', render: (_, match: ChildMatch) => <Space><Tag>{statusLabel[match.status]}</Tag>{match.lineupLocked && <Tag color="gold">名单已锁定</Tag>}</Space> },
        { title: '比分', render: (_, match: ChildMatch) => match.games.map(g => `${g.side1Score}:${g.side2Score}`).join(' / ') || '-' },
        { title: '场地', render: (_, match: ChildMatch) => match.venue?.name || '-' },
        { title: '裁判', render: (_, match: ChildMatch) => match.referee?.username || '-' },
        { title: '操作', render: (_, match: ChildMatch) => <Button disabled={!encounter.team1 || !encounter.team2} onClick={() => openLineup(encounter, match)}>{match.lineupLocked || match.status !== 'PENDING' ? '查看名单' : '填报名单'}</Button> },
      ]} /> }} />
    </Card>
    <TeamRosterImportModal competition={competition} open={batchOpen} onClose={() => setBatchOpen(false)} onImported={loadData} token={token} />
    <Modal title="团体赛设置" open={settingsOpen} onCancel={() => setSettingsOpen(false)} onOk={() => submit(saveSettings)} okText="保存" cancelText="取消" confirmLoading={busy} width={760}>
      {hasDraw && <Alert type="info" title="对阵已生成，人数、项目顺序和计分规则不可修改；名称、说明和公开状态仍可编辑。" style={{ marginBottom: 16 }} />}
      <Form form={settingsForm} layout="vertical"><TeamCompetitionFields /></Form>
    </Modal>
    <Modal title={editingTeam ? '例外调整队员' : '从选手库建队'} open={teamOpen} onCancel={() => setTeamOpen(false)} onOk={() => editingTeam ? Modal.confirm({ title: '确认例外调整本队名单？', content: '原则上队员名单不能更改。本次确认将按当前选择调整人员，允许人数偏离原配置；已结束子项保留原记录。', okText: '确认调整', cancelText: '取消', onOk: () => submit(saveTeam) }) : submit(saveTeam)} okText="保存" cancelText="取消" confirmLoading={busy} width={700}>
      <Alert type="info" title={rosterText} style={{ marginBottom: 16 }} />
      <Form form={teamForm} layout="vertical">
        <Form.Item name="name" label="队伍名称" rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item name="affiliation" label="所属单位" rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item name="playerIds" label="队员" rules={[{ required: true }]} extra={`已选 ${selected.length} 人：${selected.filter(p => p.gender === 'MALE').length} 男 ${selected.filter(p => p.gender === 'FEMALE').length} 女`}>
          <Select mode="multiple" showSearch optionFilterProp="label" options={players.filter(p => !taken.has(p.id)).map(p => ({ value: p.id, label: `${p.name} · ${p.gender === 'MALE' ? '男' : '女'} · ${p.affiliation}` }))} />
        </Form.Item>
      </Form>
    </Modal>
    <Modal title={addingToTeam ? `例外补充队员 · ${addingToTeam.name}` : '导入队员建队'} open={importOpen} onCancel={() => setImportOpen(false)} onOk={() => addingToTeam ? Modal.confirm({ title: '确认临时补充队员？', content: '原则上不能临时加人。确认后，新增人员将加入本队名单，可供后续填报或例外换人选择。', okText: '确认补充', cancelText: '取消', onOk: () => submit(importTeam) }) : submit(importTeam)} okText="继续" cancelText="取消" confirmLoading={busy} width={700}>
      <Alert type="info" title={rosterText} description="每行填写：姓名,性别(男/女),单位,联系方式。支持粘贴 Excel 单元格；此处仅录入队员，出场项目在赛前填报。" style={{ marginBottom: 16 }} />
      <Form form={importForm} layout="vertical">
        <Form.Item name="teamName" label="队伍名称" rules={[{ required: true }]}><Input disabled={Boolean(addingToTeam)} /></Form.Item>
        <Form.Item name="affiliation" label="所属单位" rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item name="playersText" label="队员数据" rules={[{ required: true }]}><Input.TextArea rows={8} placeholder={'张三,男,一队\n李四,女,一队'} /></Form.Item>
      </Form>
    </Modal>
    <Modal title={active ? `第 ${active.match.matchNo} 项 · ${active.item.eventTypeLabel}出场名单` : '出场名单'} open={Boolean(active)} onCancel={() => setActive(null)} width={740} footer={activeReadonly ? <Space>{!activeFinal && <Button danger onClick={() => Modal.confirm({ title: '确认例外换人？', content: '原则上名单锁定后或比赛中不能换人。确认后可从本队名单重新选择，当前比分和比赛进度保留。', okText: '确认例外换人', cancelText: '取消', onOk: () => setLineupOverride(true) })}>例外换人</Button>}<Button onClick={() => setActive(null)}>关闭</Button></Space> : <Space wrap><Button onClick={() => setActive(null)}>取消</Button>{!lineupOverride && <Button loading={busy} onClick={() => submit(() => saveLineup(false))}>保存待确认</Button>}<Button type="primary" loading={busy} onClick={() => submit(() => saveLineup(true))}>{lineupOverride ? '保存例外换人' : '保存并锁定本项名单'}</Button></Space>}>
      <Alert type={activeReadonly ? 'info' : 'warning'} showIcon title={activeReadonly ? '本项名单已锁定或比赛已结束。' : lineupOverride ? '本次为已确认的例外换人，比分和进度保留。选手必须来自本队名单。' : '请确认双方选手后锁定本项名单。每位队员在本轮最多兼任两项。'} style={{ marginBottom: 16 }} />
      <Form form={lineupForm} layout="vertical" disabled={activeReadonly}>
        <Form.List name="selections">{fields => <Space orientation="vertical" style={{ width: '100%' }}>{fields.map(field => {
          const current = selections[field.name];
          const team = competition.teams.find(t => t.id === current?.teamId);
          const type = active?.item.eventType ?? '';
          const options = (slot: 1 | 2) => (team?.members ?? []).filter(player => {
            if (type.startsWith('MENS_') && player.gender !== 'MALE') return false;
            if (type.startsWith('WOMENS_') && player.gender !== 'FEMALE') return false;
            const otherId = slot === 1 ? current?.player2Id : current?.player1Id;
            if (player.id === otherId) return false;
            const other = team?.members.find(p => p.id === otherId);
            return type !== 'MIXED_DOUBLES' || !other || other.gender !== player.gender;
          }).map(player => ({ value: player.id, label: `${player.name}（${player.gender === 'MALE' ? '男' : '女'}）` }));
          return <Card key={field.key} size="small" title={team?.name ?? '队伍'}>
            <Form.Item name={[field.name, 'teamId']} hidden><Input /></Form.Item>
            <Form.Item name={[field.name, 'teamCompetitionItemId']} hidden><Input /></Form.Item>
            <Form.Item name={[field.name, 'player1Id']} label="出场选手 1" rules={[{ required: true, message: '请选择本队出场选手' }]}><Select showSearch optionFilterProp="label" options={options(1)} /></Form.Item>
            {doubles(type) && <Form.Item name={[field.name, 'player2Id']} label="出场选手 2" rules={[{ required: true, message: '双打须选择第二位选手' }]}><Select showSearch optionFilterProp="label" options={options(2)} /></Form.Item>}
          </Card>;
        })}</Space>}</Form.List>
      </Form>
    </Modal>
  </Space>;
}
