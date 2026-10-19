'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import {
  Button,
  Card,
  Form,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import { PlusOutlined, EyeOutlined, ReloadOutlined } from '@ant-design/icons';
import { apiFetch } from '@/lib/api';

import TeamCompetitionFields, { TEAM_EVENT_OPTIONS, teamDefaults, teamAppearanceLabel, teamFormatLabel, teamFormatPayload } from '@/components/TeamCompetitionFields';

type Tournament = {
  id: string;
  name: string;
  edition: number;
};

type TeamCompetition = {
  id: string;
  tournamentId: string;
  name: string;
  description?: string | null;
  format?: string;
  groupCount?: number | null;
  advancePerGroup?: number | null;
  winThreshold: number;
  maxPlayerAppearances: number;
  isPublished: boolean;
  items: Array<{ id: string; eventType: string; eventTypeLabel: string; sortOrder: number }>;
  tournament: Tournament;
  _count?: { teams: number; teamMatches: number };
};

export default function TeamCompetitionsPage() {
  const { data: session } = useSession();
  const token = session?.user?.accessToken as string | undefined;
  const router = useRouter();
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [competitions, setCompetitions] = useState<TeamCompetition[]>([]);
  const [selectedTournamentId, setSelectedTournamentId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm();

  const filteredCompetitions = useMemo(
    () => competitions.filter((item) => !selectedTournamentId || item.tournamentId === selectedTournamentId),
    [competitions, selectedTournamentId],
  );

  const loadBase = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [tournamentData, competitionData] = await Promise.all([
        apiFetch<Tournament[]>('/tournaments', { token }),
        apiFetch<TeamCompetition[]>('/team-competitions', { token }),
      ]);
      setTournaments(tournamentData);
      setCompetitions(competitionData);
      setSelectedTournamentId((current) => current || tournamentData[0]?.id || '');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载团体赛失败');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadBase(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadBase]);

  function openCreate() {
    form.resetFields();
    form.setFieldsValue({
      tournamentId: selectedTournamentId || tournaments[0]?.id,
      ...teamDefaults,
    });
    setOpen(true);
  }

  async function handleSubmit() {
    const values = await form.validateFields();
    setSubmitting(true);
    try {
      await apiFetch('/team-competitions', {
        method: 'POST',
        token,
        body: JSON.stringify({ ...values, ...teamFormatPayload(values), items: values.items.map((item: { eventType: string }, index: number) => ({ eventType: item.eventType, sortOrder: index + 1 })) }),
      });
      message.success('团体赛已创建');
      setOpen(false);
      await loadBase();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '创建团体赛失败');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>团体赛管理</Typography.Title>
          <Typography.Text type="secondary">管理团体赛配置、队伍、对阵与出场名单。</Typography.Text>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={loadBase} loading={loading}>刷新</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>创建团体赛</Button>
        </Space>
      </div>

      <Card>
        <Select
          style={{ width: 360 }}
          placeholder="按赛事筛选"
          value={selectedTournamentId || undefined}
          onChange={setSelectedTournamentId}
          options={tournaments.map((item) => ({ value: item.id, label: item.name }))}
        />
      </Card>

      <Table
        rowKey="id"
        loading={loading}
        dataSource={filteredCompetitions}
        pagination={false}
        columns={[
          {
            title: '团体赛',
            render: (_, row: TeamCompetition) => (
              <Space direction="vertical" size={0}>
                <Typography.Text strong>{row.name}</Typography.Text>
                <Typography.Text type="secondary">{row.tournament.name}</Typography.Text>
              </Space>
            ),
          },
          {
            title: '项目顺序',
            render: (_, row: TeamCompetition) => row.items.map((item) => TEAM_EVENT_OPTIONS.find(option => option.value === item.eventType)?.label ?? item.eventType).join(' → '),
          },
          { title: '赛制', render: (_, row: TeamCompetition) => `${teamFormatLabel(row.format)}${row.groupCount ? ` · ${row.groupCount} 组` : ''}${row.format === 'GROUP_PLUS_KNOCKOUT' ? ` · 每组晋级 ${row.advancePerGroup ?? 2} 队` : ''}` },
          { title: '抢几胜', dataIndex: 'winThreshold', width: 100 },
          { title: '每队人数', render: () => '人数不限' },
          { title: '兼项规则', render: (_, row: TeamCompetition) => teamAppearanceLabel(row.maxPlayerAppearances) },
          { title: '队伍数', render: (_, row: TeamCompetition) => row._count?.teams ?? 0, width: 90 },
          { title: '对阵数', render: (_, row: TeamCompetition) => row._count?.teamMatches ?? 0, width: 90 },
          {
            title: '状态',
            width: 120,
            render: (_, row: TeamCompetition) => row.isPublished ? <Tag color="green">已公开</Tag> : <Tag>未公开</Tag>,
          },
          {
            title: '操作',
            width: 120,
            render: (_, row: TeamCompetition) => (
              <Button icon={<EyeOutlined />} onClick={() => router.push(`/nicaiyixiahh/team-competitions/${row.id}`)}>
                进入详情
              </Button>
            ),
          },
        ]}
      />

      <Modal
        title="创建团体赛"
        open={open}
        onOk={handleSubmit}
        onCancel={() => setOpen(false)}
        confirmLoading={submitting}
        width={720}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="tournamentId" label="所属赛事" rules={[{ required: true, message: '请选择赛事' }]}>
            <Select options={tournaments.map((item) => ({ value: item.id, label: item.name }))} />
          </Form.Item>
          <TeamCompetitionFields />
        </Form>
      </Modal>
    </Space>
  );
}
