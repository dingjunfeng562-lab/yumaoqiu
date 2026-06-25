'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Button, Card, Select, Space, Table, Tag, Typography, message } from 'antd';
import { DownloadOutlined, FileExcelOutlined, ReloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { apiFetch } from '@/lib/api';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

type Tournament = {
  id: string;
  name: string;
  edition: number;
  status: string;
  startDate: string;
  endDate: string;
  isArchived: boolean;
  _count?: { events: number };
};

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  REGISTRATION_NOT_STARTED: { label: '报名未开始', color: 'default' },
  REGISTRATION_OPEN: { label: '报名中', color: 'orange' },
  REGISTRATION_CLOSED: { label: '报名已结束', color: 'red' },
  ONGOING: { label: '比赛进行中', color: 'green' },
  FINISHED: { label: '已结束', color: 'blue' },
};

const exportKinds = [
  { key: 'schedule', title: '赛程表', description: '按项目、场地、时间输出全部场次。' },
  { key: 'results', title: '成绩册', description: '输出比分、胜负和名次汇总。' },
  { key: 'registrations', title: '报名表', description: '输出选手信息、报名项目和分组种子。' },
  { key: 'bracket', title: '对阵表', description: '按场地排程输出对阵、时间与场地内场次。' },
  { key: 'orderbook', title: '秩序册', description: '日程表概览 + 按节次/场地排布的秩序表网格（项目、场次号、组别签位、姓名）。' },
];

function fileNameFromDisposition(disposition: string | null, fallback: string) {
  if (!disposition) return fallback;
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/)?.[1];
  if (encoded) return decodeURIComponent(encoded);
  const normal = disposition.match(/filename="?([^";]+)"?/)?.[1];
  return normal ?? fallback;
}

function exportFallbackName(tournament: Tournament | null, kind: string) {
  const safeName = (tournament?.name ?? '赛事').trim().replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ');
  const label = exportKinds.find((item) => item.key === kind)?.title ?? kind;
  return `${safeName || '赛事'}-${dayjs().format('YYYYMMDD')}-${label}.xls`;
}

export default function AdminExportsPage() {
  const { data: session } = useSession();
  const token = session?.user?.accessToken;
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [selectedTournamentId, setSelectedTournamentId] = useState('');
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState('');

  const selectedTournament = useMemo(
    () => tournaments.find((item) => item.id === selectedTournamentId) ?? null,
    [selectedTournamentId, tournaments],
  );

  async function loadTournaments() {
    if (!token) return;
    setLoading(true);
    try {
      const data = await apiFetch<Tournament[]>('/tournaments', { token });
      setTournaments(data);
      setSelectedTournamentId((current) => current || data[0]?.id || '');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载赛事失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    Promise.resolve()
      .then(() => {
        if (!cancelled) setLoading(true);
        return apiFetch<Tournament[]>('/tournaments', { token });
      })
      .then((data) => {
        if (cancelled) return;
        setTournaments(data);
        setSelectedTournamentId((current) => current || data[0]?.id || '');
      })
      .catch((error) => message.error(error instanceof Error ? error.message : '加载赛事失败'))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function download(kind: string) {
    if (!token || !selectedTournamentId) return;
    setDownloading(kind);
    try {
      const res = await fetch(`${API_BASE}/exports/tournaments/${selectedTournamentId}/${kind}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({ message: '导出失败' }));
        throw new Error(error.message ?? '导出失败');
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileNameFromDisposition(
        res.headers.get('content-disposition'),
        exportFallbackName(selectedTournament, kind),
      );
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      message.success('导出已开始');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '导出失败');
    } finally {
      setDownloading('');
    }
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>数据导出</Typography.Title>
          <Typography.Text type="secondary">导出赛事赛程表、成绩册和报名表，文件可直接用 Excel 打开。</Typography.Text>
        </div>
        <Button icon={<ReloadOutlined />} onClick={loadTournaments} loading={loading}>
          刷新
        </Button>
      </div>

      <Card>
        <Space wrap>
          <Select
            style={{ width: 360 }}
            value={selectedTournamentId || undefined}
            loading={loading}
            placeholder="选择赛事"
            options={tournaments.map((item) => ({
              value: item.id,
              label: item.name,
            }))}
            onChange={setSelectedTournamentId}
          />
          {selectedTournament ? (
            <Tag color={STATUS_LABELS[selectedTournament.status]?.color}>
              {STATUS_LABELS[selectedTournament.status]?.label ?? selectedTournament.status}
            </Tag>
          ) : null}
        </Space>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
        {exportKinds.map((item) => (
          <Card key={item.key}>
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <FileExcelOutlined style={{ fontSize: 28, color: '#16a34a' }} />
              <div>
                <Typography.Title level={4} style={{ margin: 0 }}>{item.title}</Typography.Title>
                <Typography.Text type="secondary">{item.description}</Typography.Text>
              </div>
              <Button
                type="primary"
                icon={<DownloadOutlined />}
                block
                disabled={!selectedTournamentId}
                loading={downloading === item.key}
                onClick={() => download(item.key)}
              >
                导出 {item.title}
              </Button>
            </Space>
          </Card>
        ))}
      </div>

      <Card title="赛事列表">
        <Table
          rowKey="id"
          loading={loading}
          dataSource={tournaments}
          pagination={{ pageSize: 8 }}
          columns={[
            { title: '赛事', dataIndex: 'name' },
            {
              title: '时间',
              render: (_, row: Tournament) =>
                `${dayjs(row.startDate).format('YYYY/MM/DD')} - ${dayjs(row.endDate).format('YYYY/MM/DD')}`,
            },
            { title: '项目数', render: (_, row: Tournament) => row._count?.events ?? 0, width: 100 },
            {
              title: '状态',
              dataIndex: 'status',
              width: 140,
              render: (value: string, row: Tournament) => (
                <Space>
                  <Tag color={STATUS_LABELS[value]?.color}>{STATUS_LABELS[value]?.label ?? value}</Tag>
                  {row.isArchived && <Tag>已归档</Tag>}
                </Space>
              ),
            },
            {
              title: '操作',
              width: 130,
              render: (_, row: Tournament) => (
                <Button size="small" onClick={() => setSelectedTournamentId(row.id)}>
                  选择导出
                </Button>
              ),
            },
          ]}
        />
      </Card>
    </Space>
  );
}
