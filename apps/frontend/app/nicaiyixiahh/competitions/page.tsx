'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Button, Card, Dropdown, Input, Modal, QRCode, Space, Table, Tag, Typography, message } from 'antd';
import type { MenuProps } from 'antd';
import {
  AuditOutlined,
  CopyOutlined,
  DesktopOutlined,
  DownloadOutlined,
  EyeOutlined,
  MoreOutlined,
  PauseCircleOutlined,
  PictureOutlined,
  PlusOutlined,
  PlayCircleOutlined,
  QrcodeOutlined,
  ReloadOutlined,
  TeamOutlined,
  TrophyOutlined,
  UndoOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons';
import { apiFetch } from '@/lib/api';
import { useCurrentAccess } from '@/lib/use-current-role';
import { CompetitionRankingsModal } from '@/components/admin/CompetitionRankingsModal';

type Competition = {
  id: string;
  title: string;
  startDate: string;
  endDate: string;
  location?: string | null;
  events?: string[];
  statusLabel: string;
  registrationStatus: string;
  isArchived: boolean;
  isPublished: boolean;
  approvalStatus?: 'PENDING' | 'APPROVED' | 'REJECTED';
  rejectReason?: string | null;
  photoAccessEnabled?: boolean;
  counts: {
    all: number;
    pending: number;
    approved: number;
    rejected: number;
    removed: number;
  };
};

type PhotoAccess = {
  competitionId: string;
  title: string;
  accessToken: string;
  path: string;
  url: string;
};

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('zh-CN');
}

function competitionPath(record: Competition, suffix: string) {
  return `/nicaiyixiahh/competitions/${encodeURIComponent(record.id)}/${suffix}`;
}

function CountMetric({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ minWidth: 30, textAlign: 'center' }}>
      <div
        style={{
          color,
          fontSize: 15,
          fontWeight: 700,
          lineHeight: 1.1,
          // 批量导入后「通过」可能是三四位数，等宽数字 + 不换行，避免撑破列宽。
          fontVariantNumeric: 'tabular-nums',
          whiteSpace: 'nowrap',
        }}
      >
        {value}
      </div>
      <div style={{ marginTop: 2, color: '#94a3b8', fontSize: 10, fontWeight: 600 }}>{label}</div>
    </div>
  );
}

export default function AdminCompetitionsPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const access = useCurrentAccess();
  const token = session?.user?.accessToken as string | undefined;
  const role = access.role;
  const canOperate = access.can('TOURNAMENT_ADMIN');
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [loading, setLoading] = useState(false);
  const [rankingCompetition, setRankingCompetition] = useState<Competition>();
  const [qrLoadingId, setQrLoadingId] = useState<string>();
  const [photoAccess, setPhotoAccess] = useState<PhotoAccess>();
  const [qrOpen, setQrOpen] = useState(false);
  const [screenAccess, setScreenAccess] = useState<{ id: string; title: string; url: string }>();
  const qrContainerRef = useRef<HTMLDivElement>(null);

  const loadCompetitions = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const data = await apiFetch<Competition[]>('/admin/competitions', { token });
      setCompetitions(data);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '赛事加载失败');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadCompetitions();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadCompetitions]);

  async function togglePublication(record: Competition) {
    if (!token) return;
    const action = record.isPublished ? 'unpublish' : 'publish';
    try {
      await apiFetch(`/admin/competitions/${record.id}/${action}`, {
        method: 'PATCH',
        token,
      });
      message.success(record.isPublished ? '赛事已下架' : '赛事已发布');
      await loadCompetitions();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '操作失败');
    }
  }

  async function restoreCompetition(record: Competition) {
    if (!token || role !== 'ROOT') return;
    try {
      await apiFetch(`/tournaments/${encodeURIComponent(record.id)}/restore`, {
        method: 'PATCH',
        token,
      });
      message.success('赛事已恢复');
      await loadCompetitions();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '恢复失败');
    }
  }

  async function showPhotoQrCode(record: Competition) {
    if (!token) return;
    setQrLoadingId(record.id);
    try {
      const data = await apiFetch<Omit<PhotoAccess, 'url'>>(
        `/admin/competitions/${encodeURIComponent(record.id)}/photo-access`,
        { method: 'POST', token },
      );
      const url = new URL(data.path, window.location.origin).toString();
      setPhotoAccess({ ...data, url });
      setCompetitions((current) =>
        current.map((item) =>
          item.id === record.id ? { ...item, photoAccessEnabled: true } : item,
        ),
      );
      setQrOpen(true);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '二维码生成失败');
    } finally {
      setQrLoadingId(undefined);
    }
  }

  async function copyPhotoAccessUrl() {
    if (!photoAccess) return;
    try {
      await navigator.clipboard.writeText(photoAccess.url);
      message.success('访问地址已复制');
    } catch {
      message.error('复制失败，请手动复制地址');
    }
  }

  function downloadQrCode() {
    const canvas = qrContainerRef.current?.querySelector('canvas');
    if (!canvas || !photoAccess) return;
    const link = document.createElement('a');
    link.download = `${photoAccess.title}-赛事图片二维码.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  }

  function confirmTogglePublication(record: Competition) {
    Modal.confirm({
      title: record.isPublished ? '确认下架该赛事？' : '确认发布该赛事？',
      content: record.isPublished
        ? '下架后前台将不再展示该赛事。'
        : '发布后前台将展示该赛事，已审核通过的选手和项目会同步可见。',
      okText: record.isPublished ? '下架' : '发布',
      cancelText: '取消',
      onOk: () => togglePublication(record),
    });
  }

  function confirmRestore(record: Competition) {
    Modal.confirm({
      title: '确认恢复该归档赛事？',
      content: '恢复后该赛事会重新出现在赛事配置和赛事管理中。',
      okText: '恢复',
      cancelText: '取消',
      onOk: () => restoreCompetition(record),
    });
  }

  function openScreen(record: Competition) {
    setScreenAccess({
      id: record.id,
      title: record.title,
      url: new URL(`/live-screen/${encodeURIComponent(record.id)}`, window.location.origin).toString(),
    });
  }

  function moreMenuItems(record: Competition): NonNullable<MenuProps['items']> {
    const items: NonNullable<MenuProps['items']> = [];
    if (canOperate) {
      if (record.isArchived) {
        if (role === 'ROOT') {
          items.push({ key: 'restore', icon: <UndoOutlined />, label: '恢复赛事' });
        }
      } else {
        items.push({
          key: 'publish',
          icon: record.isPublished ? <PauseCircleOutlined /> : <PlayCircleOutlined />,
          label: record.isPublished
            ? '下架赛事'
            : record.approvalStatus === 'APPROVED'
              ? '发布赛事'
              : '发布赛事（待审核）',
          disabled: !record.isPublished && record.approvalStatus !== 'APPROVED',
        });
      }
    }
    if (access.can('PHOTOS')) {
      items.push(
        { key: 'watermark', icon: <PictureOutlined />, label: '水印设置' },
        { key: 'rankings', icon: <TrophyOutlined />, label: '设置排名', disabled: !canOperate },
        { key: 'photos', icon: <PictureOutlined />, label: '图片管理' },
        {
          key: 'qr',
          icon: <QrcodeOutlined />,
          label: qrLoadingId === record.id
            ? '二维码生成中…'
            : record.photoAccessEnabled
              ? '查看图片二维码'
              : '生成图片二维码',
          disabled: qrLoadingId === record.id,
        },
        { key: 'screen', icon: <DesktopOutlined />, label: '赛事大屏' },
      );
    }
    if (role === 'ROOT') {
      items.push({ key: 'broadcast', icon: <VideoCameraOutlined />, label: '赛事直播' });
    }
    return items;
  }

  function handleMoreAction(record: Competition, key: string) {
    switch (key) {
      case 'publish':
        confirmTogglePublication(record);
        break;
      case 'restore':
        confirmRestore(record);
        break;
      case 'watermark':
        router.push(competitionPath(record, 'watermark'));
        break;
      case 'rankings':
        setRankingCompetition(record);
        break;
      case 'photos':
        router.push(competitionPath(record, 'photos'));
        break;
      case 'qr':
        void showPhotoQrCode(record);
        break;
      case 'screen':
        openScreen(record);
        break;
      case 'broadcast':
        router.push(`/nicaiyixiahh/broadcasts?tournamentId=${encodeURIComponent(record.id)}`);
        break;
      default:
        break;
    }
  }

  const columns = [
    {
      title: '赛事',
      key: 'title',
      width: 200,
      render: (_: unknown, record: Competition) => (
        <Space direction="vertical" size={1} style={{ width: '100%' }}>
          <Typography.Text strong ellipsis={{ tooltip: record.title }} style={{ fontSize: 13 }}>
            {record.title}
          </Typography.Text>
          <Typography.Text type="secondary" ellipsis style={{ fontSize: 12 }}>
            {record.location || '地点待公布'}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: '比赛时间',
      key: 'date',
      width: 140,
      render: (_: unknown, record: Competition) => (
        <div style={{ fontSize: 12, lineHeight: 1.65 }}>
          <div>{formatDate(record.startDate)}</div>
          <div style={{ color: '#94a3b8' }}>至 {formatDate(record.endDate)}</div>
        </div>
      ),
    },
    {
      title: '比赛项目',
      key: 'events',
      width: 170,
      render: (_: unknown, record: Competition) => (
        record.events?.length ? (
          <Space size={[4, 4]} wrap>
            {record.events.map((event) => (
              <Tag key={event} style={{ marginInlineEnd: 0 }}>{event}</Tag>
            ))}
          </Space>
        ) : (
          <Typography.Text type="secondary">项目待公布</Typography.Text>
        )
      ),
    },
    {
      title: '状态',
      key: 'status',
      width: 150,
      render: (_: unknown, record: Competition) => (
        <Space direction="vertical" size={4}>
          <Tag color={record.isArchived ? 'default' : record.isPublished ? 'blue' : 'default'}>
            {record.isArchived ? '已归档' : record.isPublished ? '已发布' : '未发布'}
          </Tag>
          {record.isPublished && !record.isArchived && record.statusLabel !== record.registrationStatus ? (
            <Tag color="cyan">{record.statusLabel}</Tag>
          ) : null}
          <Tag color={record.registrationStatus === '报名中' ? 'green' : 'orange'}>
            {record.registrationStatus}
          </Tag>
          {record.approvalStatus === 'PENDING' ? (
            <Tag color="gold">待超级管理员审核</Tag>
          ) : record.approvalStatus === 'REJECTED' ? (
            <Tag color="red">审核驳回</Tag>
          ) : null}
        </Space>
      ),
    },
    {
      title: '报名审核',
      key: 'counts',
      width: 170,
      render: (_: unknown, record: Competition) => (
        <div style={{ display: 'flex', gap: 8 }}>
          <CountMetric
            label="待审"
            value={record.counts.pending}
            color={record.counts.pending > 0 ? '#d97706' : '#64748b'}
          />
          <CountMetric label="通过" value={record.counts.approved} color="#16a34a" />
          <CountMetric label="拒绝" value={record.counts.rejected} color="#94a3b8" />
        </div>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 300,
      render: (_: unknown, record: Competition) => {
        const items = moreMenuItems(record);
        return (
          <Space size={6} wrap>
            <Button
              size="small"
              type="primary"
              icon={<AuditOutlined />}
              onClick={() => router.push(competitionPath(record, 'registrations'))}
            >
              报名审核
            </Button>
            <Button
              size="small"
              icon={<TeamOutlined />}
              onClick={() => router.push(competitionPath(record, 'players'))}
            >
              选手
            </Button>
            {items.length ? (
              <Dropdown
                trigger={['click']}
                placement="bottomRight"
                menu={{
                  items,
                  onClick: ({ key }) => handleMoreAction(record, key),
                }}
              >
                <Button size="small" icon={<MoreOutlined />}>更多</Button>
              </Dropdown>
            ) : null}
          </Space>
        );
      },
    },
  ];

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>
            赛事管理
          </Typography.Title>
          <Typography.Text type="secondary">
            {role === 'ADMIN' ? '查看自己的赛事，并管理报名和参赛选手。首页仍公开展示所有管理员发布的赛事。' : '管理赛事发布状态，并按赛事进入独立的报名审核和参赛选手列表。'}
          </Typography.Text>
        </div>
        <Space wrap>
          <Button icon={<ReloadOutlined />} onClick={() => void loadCompetitions()} loading={loading}>
            刷新
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => router.push('/nicaiyixiahh/tournaments?create=1')}>
            新建赛事
          </Button>
          <Button icon={<EyeOutlined />} onClick={() => router.push('/competitions')}>
            查看前台赛事
          </Button>
        </Space>
      </div>
      <Card
        style={{ marginTop: 16 }}
        title={<span style={{ fontSize: 14, fontWeight: 700 }}>赛事列表</span>}
        extra={<Typography.Text type="secondary">共 {competitions.length} 项</Typography.Text>}
        styles={{ body: { padding: 0 } }}
      >
        <Table
          rowKey="id"
          columns={columns}
          dataSource={competitions}
          loading={loading}
          pagination={{ pageSize: 10, showSizeChanger: false, hideOnSinglePage: true }}
          scroll={{ x: 1130 }}
          tableLayout="fixed"
          size="middle"
          locale={{ emptyText: '暂无赛事' }}
        />
      </Card>
      {rankingCompetition && token && <CompetitionRankingsModal
        key={rankingCompetition.id} competition={rankingCompetition} token={token}
        onClose={() => setRankingCompetition(undefined)} />}
      <Modal title={screenAccess ? `${screenAccess.title} · 赛事大屏` : '赛事大屏'} open={Boolean(screenAccess)} onCancel={() => setScreenAccess(undefined)} footer={null}>
        {screenAccess && <Space orientation="vertical" size={16} style={{ width: '100%' }}>
          <Typography.Text type="secondary">打开大屏后，将鼠标移到右下角，点击“大屏设置”即可边调边看。</Typography.Text>
          <div data-allow-copy><Input aria-label="赛事大屏链接" value={screenAccess.url} readOnly /></div>
          <Space>
            <Button type="primary" icon={<DesktopOutlined />} href={screenAccess.url} target="_blank" rel="noopener noreferrer">打开大屏</Button>
            <Button icon={<CopyOutlined />} onClick={async () => {
              try { await navigator.clipboard.writeText(screenAccess.url); message.success('大屏链接已复制'); }
              catch { message.error('复制失败，请手动复制链接'); }
            }}>复制链接</Button>
          </Space>
        </Space>}
      </Modal>
      <Modal
        title={photoAccess ? `${photoAccess.title} · 图片二维码` : '赛事图片二维码'}
        open={qrOpen}
        footer={null}
        onCancel={() => setQrOpen(false)}
        width={440}
      >
        {photoAccess ? (
          <Space direction="vertical" size={18} style={{ width: '100%', alignItems: 'center', paddingTop: 8 }}>
            <div ref={qrContainerRef} style={{ padding: 12, borderRadius: 12, background: '#fff' }}>
              <QRCode type="canvas" value={photoAccess.url} size={260} bordered={false} />
            </div>
            <Typography.Text type="secondary" style={{ textAlign: 'center' }}>
              扫码后先显示本次比赛封面，点击封面任意位置进入照片墙。
            </Typography.Text>
            <Input value={photoAccess.url} readOnly addonAfter={<CopyOutlined onClick={copyPhotoAccessUrl} />} />
            <Space>
              <Button icon={<CopyOutlined />} onClick={copyPhotoAccessUrl}>
                复制地址
              </Button>
              <Button type="primary" icon={<DownloadOutlined />} onClick={downloadQrCode}>
                下载二维码
              </Button>
            </Space>
          </Space>
        ) : null}
      </Modal>
    </div>
  );
}
