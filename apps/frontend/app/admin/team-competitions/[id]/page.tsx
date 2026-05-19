'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import {
  Alert,
  Button,
  Card,
  Col,
  Divider,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import { PlusOutlined, ReloadOutlined, SaveOutlined } from '@ant-design/icons';
import { apiFetch } from '@/lib/api';

const EVENT_TYPE_LABELS: Record<string, string> = {
  MENS_SINGLES: '男单',
  WOMENS_SINGLES: '女单',
  MENS_DOUBLES: '男双',
  WOMENS_DOUBLES: '女双',
  MIXED_DOUBLES: '混双',
};

type Player = {
  id: string;
  name: string;
  gender: 'MALE' | 'FEMALE';
  affiliation: string;
};

type Team = {
  id: string;
  name: string;
  affiliation: string;
  memberCount: number;
  members: Player[];
};

type TeamCompetition = {
  id: string;
  name: string;
  description?: string | null;
  winThreshold: number;
  isPublished: boolean;
  items: Array<{ id: string; eventType: string; eventTypeLabel: string; sortOrder: number }>;
  teams: Team[];
  teamMatches: Array<{
    id: string;
    round: string;
    roundNo: number;
    matchNo: number;
    status: string;
    winnerTeamName?: string | null;
    team1?: { id: string; name: string } | null;
    team2?: { id: string; name: string } | null;
    team1Wins: number;
    team2Wins: number;
    lineupLocked: boolean;
    matches: Array<{
      id: string;
      matchNo: number;
      status: string;
      eventTypeLabel?: string | null;
      referee?: { username: string } | null;
      venue?: { name: string } | null;
      games: Array<{ side1Score: number; side2Score: number }>;
    }>;
  }>;
};

type QuickPreview = {
  assignments: Array<{ eventType: string; names: string[] }>;
  benchNames?: string[];
  uniquePlayerNames?: string[];
};

export default function TeamCompetitionDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const { data: session } = useSession();
  const token = session?.user?.accessToken as string | undefined;
  const [competition, setCompetition] = useState<TeamCompetition | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(false);
  const [teamOpen, setTeamOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [lineupOpen, setLineupOpen] = useState(false);
  const [preview, setPreview] = useState<QuickPreview | null>(null);
  const [activeTeamMatchId, setActiveTeamMatchId] = useState<string>('');
  const [teamForm] = Form.useForm();
  const [importForm] = Form.useForm();
  const [quickForm] = Form.useForm();
  const [lineupForm] = Form.useForm();

  const playerOptions = useMemo(
    () => players.map((player) => ({ value: player.id, label: `${player.name} · ${player.affiliation}` })),
    [players],
  );

  async function loadData() {
    if (!token || !id) return;
    setLoading(true);
    try {
      const [competitionData, playerData] = await Promise.all([
        apiFetch<TeamCompetition>(`/team-competitions/${id}`, { token }),
        apiFetch<Player[]>('/players', { token }),
      ]);
      setCompetition(competitionData);
      setPlayers(playerData);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载团体赛详情失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, [token, id]);

  async function createTeam() {
    const values = await teamForm.validateFields();
    await apiFetch(`/team-competitions/${id}/teams`, {
      method: 'POST',
      token,
      body: JSON.stringify(values),
    });
    message.success('队伍已创建');
    setTeamOpen(false);
    teamForm.resetFields();
    await loadData();
  }

  async function importTeam() {
    const values = await importForm.validateFields();
    const lines = String(values.playersText)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const playersPayload = lines.map((line) => {
      const [name, genderText, affiliation, contact] = line.split(/[，,]/).map((item) => item.trim());
      return {
        name,
        gender: genderText === '女' ? 'FEMALE' : 'MALE',
        affiliation: affiliation || values.affiliation,
        contact,
      };
    });
    await apiFetch(`/team-competitions/${id}/teams/import`, {
      method: 'POST',
      token,
      body: JSON.stringify({
        teamName: values.teamName,
        affiliation: values.affiliation,
        players: playersPayload,
      }),
    });
    message.success('Excel文本导入已完成');
    setImportOpen(false);
    importForm.resetFields();
    await loadData();
  }

  async function previewQuick() {
    const values = await quickForm.validateFields();
    const data = await apiFetch<QuickPreview>(`/team-competitions/${id}/teams/quick-preview`, {
      method: 'POST',
      token,
      body: JSON.stringify(values),
    });
    setPreview(data);
  }

  async function createQuickTeam() {
    const values = await quickForm.validateFields();
    await apiFetch(`/team-competitions/${id}/teams/quick-create`, {
      method: 'POST',
      token,
      body: JSON.stringify(values),
    });
    message.success('快速录入建队成功');
    setQuickOpen(false);
    setPreview(null);
    quickForm.resetFields();
    await loadData();
  }

  async function generateDraw(force = false) {
    await apiFetch(`/team-competitions/${id}/draw`, {
      method: 'POST',
      token,
      body: JSON.stringify({ force }),
    });
    message.success(force ? '已重新生成团体赛对阵' : '团体赛对阵已生成');
    await loadData();
  }

  function openLineup(teamMatchId: string) {
    setActiveTeamMatchId(teamMatchId);
    const teamMatch = competition?.teamMatches.find((item) => item.id === teamMatchId);
    if (!teamMatch || !competition) return;
    const rows = competition.items.flatMap((item) => [teamMatch.team1, teamMatch.team2]
      .filter(Boolean)
      .map((team) => ({ teamId: team!.id, teamCompetitionItemId: item.id })));
    lineupForm.setFieldsValue({ selections: rows, lock: false });
    setLineupOpen(true);
  }

  async function saveLineups() {
    const values = await lineupForm.validateFields();
    await apiFetch(`/team-competitions/team-matches/${activeTeamMatchId}/lineups`, {
      method: 'PUT',
      token,
      body: JSON.stringify(values),
    });
    message.success('出场名单已保存');
    setLineupOpen(false);
    lineupForm.resetFields();
    await loadData();
  }

  if (!competition) {
    return <Card loading={loading} />;
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>{competition.name}</Typography.Title>
          <Typography.Text type="secondary">{competition.description || '管理队伍、对阵、出场名单与子场次比分。'}</Typography.Text>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={loadData} loading={loading}>刷新</Button>
          <Button onClick={() => generateDraw(false)}>生成对阵</Button>
          <Button danger onClick={() => generateDraw(true)}>重新生成</Button>
        </Space>
      </div>

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={9}>
          <Card
            title="队伍管理"
            extra={
              <Space>
                <Button size="small" icon={<PlusOutlined />} onClick={() => setTeamOpen(true)}>手工建队</Button>
                <Button size="small" onClick={() => setImportOpen(true)}>Excel导入</Button>
                <Button size="small" onClick={() => setQuickOpen(true)}>快速录入</Button>
              </Space>
            }
          >
            <Table
              rowKey="id"
              dataSource={competition.teams}
              pagination={false}
              size="small"
              columns={[
                { title: '队伍', dataIndex: 'name' },
                { title: '单位', dataIndex: 'affiliation' },
                { title: '人数', dataIndex: 'memberCount', width: 80 },
              ]}
              expandable={{
                expandedRowRender: (team) => (
                  <div>
                    {team.members.map((member) => `${member.name}(${member.affiliation})`).join('、')}
                  </div>
                ),
              }}
            />
          </Card>
        </Col>
        <Col xs={24} xl={15}>
          <Card title="项目配置">
            <Space wrap>
              {competition.items.map((item) => (
                <Tag key={item.id} color="blue">{item.sortOrder}. {item.eventTypeLabel}</Tag>
              ))}
              <Tag color="gold">抢 {competition.winThreshold} 胜</Tag>
              {competition.isPublished && <Tag color="green">公开展示中</Tag>}
            </Space>
          </Card>
          <Card title="团体赛对阵" style={{ marginTop: 16 }}>
            <Table
              rowKey="id"
              dataSource={competition.teamMatches}
              pagination={false}
              columns={[
                { title: '轮次', render: (_, row) => `${row.round} / 第${row.matchNo}场`, width: 160 },
                { title: '对阵', render: (_, row) => `${row.team1?.name ?? '待定'} VS ${row.team2?.name ?? '待定'}` },
                { title: '总比分', render: (_, row) => `${row.team1Wins} : ${row.team2Wins}`, width: 100 },
                { title: '状态', render: (_, row) => <Tag>{row.status}</Tag>, width: 100 },
                { title: '胜方', dataIndex: 'winnerTeamName', width: 140, render: (value) => value || '-' },
                {
                  title: '操作',
                  width: 140,
                  render: (_, row) => (
                    <Button icon={<SaveOutlined />} onClick={() => openLineup(row.id)} disabled={!row.team1 || !row.team2 || row.lineupLocked}>
                      设置名单
                    </Button>
                  ),
                },
              ]}
              expandable={{
                expandedRowRender: (row) => (
                  <Table
                    rowKey="id"
                    size="small"
                    pagination={false}
                    dataSource={row.matches}
                    columns={[
                      { title: '子项', dataIndex: 'eventTypeLabel', width: 120 },
                      { title: '状态', dataIndex: 'status', width: 100 },
                      { title: '场地', render: (_, item) => item.venue?.name || '-' },
                      { title: '裁判', render: (_, item) => item.referee?.username || '-' },
                      { title: '局分', render: (_, item) => item.games.length ? item.games.map((game) => `${game.side1Score}:${game.side2Score}`).join(' / ') : '-' },
                    ]}
                  />
                ),
              }}
            />
          </Card>
        </Col>
      </Row>

      <Modal title="手工建队" open={teamOpen} onOk={createTeam} onCancel={() => setTeamOpen(false)} width={720}>
        <Form form={teamForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="name" label="队伍名称" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="affiliation" label="所属单位" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="playerIds" label="队员" rules={[{ required: true, message: '至少选择10人' }]}>
            <Select mode="multiple" options={playerOptions} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title="Excel文本导入" open={importOpen} onOk={importTeam} onCancel={() => setImportOpen(false)} width={760}>
        <Alert type="info" showIcon message="每行格式：姓名,性别(男/女),单位,联系方式，可连续粘贴至少10行。" style={{ marginBottom: 16 }} />
        <Form form={importForm} layout="vertical">
          <Form.Item name="teamName" label="队伍名称" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="affiliation" label="所属单位" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="playersText" label="队员数据" rules={[{ required: true }]}><Input.TextArea rows={10} /></Form.Item>
        </Form>
      </Modal>

      <Modal title="快速提示词录入" open={quickOpen} onOk={createQuickTeam} onCancel={() => { setQuickOpen(false); setPreview(null); }} width={760}>
        <Form form={quickForm} layout="vertical">
          <Form.Item name="teamName" label="队伍名称" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="affiliation" label="所属单位" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="prompt" label="录入内容" rules={[{ required: true }]}>
            <Input.TextArea rows={6} placeholder="例如：男单 张三, 女单 李四, 男双 王五 赵六, 女双 孙七 周八, 混双 吴九 郑十" />
          </Form.Item>
          <Button onClick={previewQuick}>先预览解析</Button>
        </Form>
        {preview ? (
          <Card size="small" style={{ marginTop: 16 }}>
            <Typography.Text strong>解析结果</Typography.Text>
            <Divider style={{ margin: '12px 0' }} />
            {preview.assignments.map((item) => (
              <p key={item.eventType} style={{ marginBottom: 8 }}>
                {EVENT_TYPE_LABELS[item.eventType] || item.eventType}：{item.names.join(' / ')}
              </p>
            ))}
            {preview.benchNames?.length ? <p style={{ marginBottom: 0 }}>其余队员：{preview.benchNames.join('、')}</p> : null}
          </Card>
        ) : null}
      </Modal>

      <Modal title="设置出场名单" open={lineupOpen} onOk={saveLineups} onCancel={() => setLineupOpen(false)} width={880}>
        <Alert type="warning" showIcon message="保存并勾选锁定后，比赛进行中不可更改。" style={{ marginBottom: 16 }} />
        <Form form={lineupForm} layout="vertical">
          <Form.List name="selections">
            {(fields) => (
              <Space direction="vertical" style={{ width: '100%' }}>
                {fields.map((field, index) => {
                  const item = competition.items[index % competition.items.length];
                  const current = lineupForm.getFieldValue(['selections', field.name]);
                  const teamName = competition.teams.find((team) => team.id === current?.teamId)?.name || '队伍';
                  const isDoubles = ['MENS_DOUBLES', 'WOMENS_DOUBLES', 'MIXED_DOUBLES'].includes(item.eventType);
                  return (
                    <Card key={field.key} size="small" title={`${item.eventTypeLabel} · ${teamName}`}>
                      <Form.Item name={[field.name, 'teamId']} hidden><Input /></Form.Item>
                      <Form.Item name={[field.name, 'teamCompetitionItemId']} hidden><Input /></Form.Item>
                      <Form.Item name={[field.name, 'player1Id']} label="选手1" rules={[{ required: true }]}>
                        <Select options={playerOptions} />
                      </Form.Item>
                      <Form.Item name={[field.name, 'player2Id']} label="选手2" rules={isDoubles ? [{ required: true }] : []}>
                        <Select allowClear options={playerOptions} />
                      </Form.Item>
                    </Card>
                  );
                })}
              </Space>
            )}
          </Form.List>
          <Form.Item name="lock" valuePropName="checked" style={{ marginTop: 16 }}>
            <Select options={[{ value: false, label: '保存但不锁定' }, { value: true, label: '保存并锁定' }]} />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
