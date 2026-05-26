'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import {
  Table,
  Button,
  Modal,
  Form,
  InputNumber,
  Radio,
  Select,
  Space,
  Popconfirm,
  Typography,
  message,
} from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { apiFetch } from '@/lib/api';

const EVENT_TYPE_LABELS: Record<string, string> = {
  MENS_SINGLES: '男子单打',
  WOMENS_SINGLES: '女子单打',
  MENS_DOUBLES: '男子双打',
  WOMENS_DOUBLES: '女子双打',
  MIXED_DOUBLES: '混合双打',
};

const FORMAT_LABELS: Record<string, string> = {
  SINGLE_ELIMINATION: '单淘汰制',
  GROUP_PLUS_KNOCKOUT: '小组赛+淘汰',
};

const SCORING_RULE_LABELS: Record<string, string> = {
  FIFTEEN_ONE: '15分1局',
  FIFTEEN_BO3: '15分3局2胜',
  TWENTYONE_BO3: '21分3局2胜',
  THIRTYONE_BO3: '31分3局2胜',
};

const SCORING_MODE_LABELS: Record<string, string> = {
  CAPPED_30: '封顶30分',
  STANDARD_GOLDEN: '标准金球制',
};

interface Tournament {
  id: string;
  name: string;
  edition: number;
}

interface Event {
  id: string;
  tournamentId: string;
  tournament: Tournament;
  type: string;
  format: string;
  scoringRule: string;
  scoringMode: string;
  customGamePoint?: number | null;
  customGameCap?: number | null;
  customGamesToWin?: number | null;
  defaultMatchMinutes?: number | null;
}

export default function EventsPage() {
  const { data: session } = useSession();
  const token = session?.user?.accessToken as string | undefined;

  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [selectedTournamentId, setSelectedTournamentId] = useState<string>('');
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Event | null>(null);
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);

  const fetchTournaments = useCallback(async () => {
    if (!token) return;
    const data = await apiFetch<Tournament[]>('/tournaments', { token });
    setTournaments(data);
    if (data.length > 0 && !selectedTournamentId) {
      setSelectedTournamentId(data[0].id);
    }
  }, [token, selectedTournamentId]);

  const fetchEvents = useCallback(async () => {
    if (!token || !selectedTournamentId) return;
    setLoading(true);
    try {
      const data = await apiFetch<Event[]>(`/events?tournamentId=${selectedTournamentId}`, { token });
      setEvents(data);
    } finally {
      setLoading(false);
    }
  }, [token, selectedTournamentId]);

  useEffect(() => { fetchTournaments(); }, [fetchTournaments]);
  useEffect(() => { fetchEvents(); }, [fetchEvents]);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldValue('tournamentId', selectedTournamentId);
    form.setFieldValue('scoringMethod', 'preset');
    setModalOpen(true);
  };

  const openEdit = (e: Event) => {
    setEditing(e);
    form.setFieldsValue({
      ...e,
      scoringMethod: e.customGamePoint ? 'custom' : 'preset',
    });
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    const values = await form.validateFields();
    const { scoringMethod, ...rest } = values as typeof values & { scoringMethod: 'preset' | 'custom' };
    const payload =
      scoringMethod === 'custom'
        ? {
            ...rest,
            scoringRule: rest.scoringRule ?? 'TWENTYONE_BO3',
          }
        : {
            ...rest,
            customGamePoint: null,
            customGameCap: null,
            customGamesToWin: null,
          };
    setSubmitting(true);
    try {
      if (editing) {
        const { tournamentId: _, ...patch } = payload;
        await apiFetch(`/events/${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify(patch),
          token,
        });
        message.success('已更新');
      } else {
        await apiFetch('/events', { method: 'POST', body: JSON.stringify(payload), token });
        message.success('已创建');
      }
      setModalOpen(false);
      fetchEvents();
    } catch (e: unknown) {
      message.error(e instanceof Error ? e.message : '操作失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await apiFetch(`/events/${id}`, { method: 'DELETE', token });
      message.success('已删除');
      fetchEvents();
    } catch (e: unknown) {
      message.error(e instanceof Error ? e.message : '删除失败');
    }
  };

  const columns = [
    { title: '单项', dataIndex: 'type', render: (v: string) => EVENT_TYPE_LABELS[v] || v },
    { title: '赛制', dataIndex: 'format', render: (v: string) => FORMAT_LABELS[v] || v },
    {
      title: '计分规则',
      key: 'scoringRule',
      render: (_: unknown, r: Event) => {
        const base = SCORING_RULE_LABELS[r.scoringRule] || r.scoringRule;
        if (r.customGamePoint) {
          const cap = r.customGameCap && r.customGameCap > r.customGamePoint ? `（封顶${r.customGameCap}）` : '';
          const gtw = r.customGamesToWin && r.customGamesToWin > 1 ? `，${r.customGamesToWin * 2 - 1}局${r.customGamesToWin}胜` : '，单局制';
          return `自定义：${r.customGamePoint}分/局${cap}${gtw}`;
        }
        return base;
      },
    },
    { title: '计分模式', dataIndex: 'scoringMode', render: (v: string) => SCORING_MODE_LABELS[v] || v },
    {
      title: '单场预估时长',
      dataIndex: 'defaultMatchMinutes',
      render: (v?: number | null) => (v ? `${v} 分钟` : '默认（按赛事）'),
    },
    {
      title: '操作',
      key: 'actions',
      render: (_: unknown, record: Event) => (
        <Space>
          <Button icon={<EditOutlined />} size="small" onClick={() => openEdit(record)}>编辑</Button>
          <Popconfirm title="确认删除？" onConfirm={() => handleDelete(record.id)}>
            <Button icon={<DeleteOutlined />} size="small" danger>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16, alignItems: 'center' }}>
        <Typography.Title level={4} style={{ margin: 0 }}>单项管理</Typography.Title>
        <Space>
          <Select
            style={{ width: 240 }}
            placeholder="选择赛事"
            value={selectedTournamentId || undefined}
            onChange={setSelectedTournamentId}
            options={tournaments.map((t) => ({ value: t.id, label: t.name }))}
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate} disabled={!selectedTournamentId}>
            添加单项
          </Button>
        </Space>
      </div>

      <Table rowKey="id" columns={columns} dataSource={events} loading={loading} pagination={false} />

      <Modal
        title={editing ? '编辑单项' : '添加单项'}
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={() => setModalOpen(false)}
        confirmLoading={submitting}
        okText="保存"
        cancelText="取消"
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          {!editing && (
            <Form.Item name="tournamentId" label="所属赛事" rules={[{ required: true }]}>
              <Select
                options={tournaments.map((t) => ({ value: t.id, label: t.name }))}
              />
            </Form.Item>
          )}
          <Form.Item name="type" label="单项类型" rules={[{ required: true, message: '请选择单项类型' }]}>
            <Select
              options={Object.entries(EVENT_TYPE_LABELS).map(([v, l]) => ({ value: v, label: l }))}
            />
          </Form.Item>
          <Form.Item name="format" label="赛制" rules={[{ required: true, message: '请选择赛制' }]}>
            <Select
              options={Object.entries(FORMAT_LABELS).map(([v, l]) => ({ value: v, label: l }))}
            />
          </Form.Item>
          <Form.Item name="scoringMethod" label="计分方式" initialValue="preset">
            <Radio.Group
              options={[
                { value: 'preset', label: '使用预设规则' },
                { value: 'custom', label: '自定义局点（覆盖预设）' },
              ]}
              optionType="button"
              buttonStyle="solid"
            />
          </Form.Item>
          <Form.Item shouldUpdate={(prev, cur) => prev.scoringMethod !== cur.scoringMethod} noStyle>
            {({ getFieldValue }) => {
              const method = getFieldValue('scoringMethod') ?? 'preset';
              if (method === 'preset') {
                return (
                  <Form.Item name="scoringRule" label="计分规则" rules={[{ required: true, message: '请选择计分规则' }]}>
                    <Select
                      options={Object.entries(SCORING_RULE_LABELS).map(([v, l]) => ({ value: v, label: l }))}
                    />
                  </Form.Item>
                );
              }
              return (
                <>
                  <Form.Item
                    name="customGamePoint"
                    label="每局多少分"
                    tooltip="一局多少分胜出，自定义模式必填"
                    rules={[{ required: true, message: '请输入每局多少分' }]}
                  >
                    <InputNumber min={1} max={999} style={{ width: '100%' }} placeholder="例：11、15、21、100" />
                  </Form.Item>
                  <Form.Item
                    name="customGameCap"
                    label="封顶分（可选）"
                    tooltip="进入加分后封顶到多少分，留空则达到目标分即胜"
                  >
                    <InputNumber min={1} max={999} style={{ width: '100%' }} placeholder="例：30" />
                  </Form.Item>
                  <Form.Item
                    name="customGamesToWin"
                    label="胜出局数"
                    tooltip="赢几局胜出整场比赛。1=单局，2=三局两胜，3=五局三胜"
                    rules={[{ required: true, message: '请输入胜出局数' }]}
                  >
                    <InputNumber min={1} max={9} style={{ width: '100%' }} placeholder="例：1 / 2 / 3" />
                  </Form.Item>
                </>
              );
            }}
          </Form.Item>
          <Form.Item name="scoringMode" label="计分模式" rules={[{ required: true, message: '请选择计分模式' }]}>
            <Select
              options={Object.entries(SCORING_MODE_LABELS).map(([v, l]) => ({ value: v, label: l }))}
            />
          </Form.Item>
          <Form.Item
            name="defaultMatchMinutes"
            label="单场预估时长（分钟）"
            tooltip="该单项每场比赛的默认预估时长，用于自动排程。留空则使用赛事配置的默认值。已生成的对阵保留各自时长，可在排程页单独调整。"
          >
            <InputNumber min={5} max={600} style={{ width: '100%' }} placeholder="留空使用赛事默认" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
