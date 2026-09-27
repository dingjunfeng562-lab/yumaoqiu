'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Button, Input, Modal, Popconfirm, QRCode, Space, Table, Tag, Typography, message } from 'antd';
import {
  AuditOutlined,
  CopyOutlined,
  DownloadOutlined,
  EditOutlined,
  EyeOutlined,
  PauseCircleOutlined,
  PictureOutlined,
  PlusOutlined,
  PlayCircleOutlined,
  QrcodeOutlined,
  TeamOutlined,
  UndoOutlined,
} from '@ant-design/icons';
import { apiFetch } from '@/lib/api';

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
  return `/admin/competitions/${encodeURIComponent(record.id)}/${suffix}`;
}

export default function AdminCompetitionsPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const token = session?.user?.accessToken as string | undefined;
  const isRoot = session?.user?.role === 'ROOT';
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [loading, setLoading] = useState(false);
  const [qrLoadingId, setQrLoadingId] = useState<string>();
  const [photoAccess, setPhotoAccess] = useState<PhotoAccess>();
  const [qrOpen, setQrOpen] = useState(false);
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
    loadCompetitions();
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
    if (!token || !isRoot) return;
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

  const columns = [
    {
      title: '赛事',
      key: 'title',
      render: (_: unknown, record: Competition) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{record.title}</Typography.Text>
          <Typography.Text type="secondary">{record.location || '地点待公布'}</Typography.Text>
        </Space>
      ),
    },
    {
      title: '比赛时间',
      key: 'date',
      width: 190,
      render: (_: unknown, record: Competition) => `${formatDate(record.startDate)} - ${formatDate(record.endDate)}`,
    },
    {
      title: '比赛项目',
      key: 'events',
      render: (_: unknown, record: Competition) => record.events?.join(' / ') || '项目待公布',
    },
    {
      title: '状态',
      key: 'status',
      width: 200,
      render: (_: unknown, record: Competition) => (
        <Space direction="vertical" size={4}>
          <Tag color={record.isPublished && !record.isArchived ? 'blue' : 'default'}>
            {record.isArchived ? '已归档' : record.isPublished ? record.statusLabel : '未发布'}
          </Tag>
          {record.approvalStatus === 'PENDING' ? (
            <Tag color="gold">待总管理员审核</Tag>
          ) : record.approvalStatus === 'REJECTED' ? (
            <Tag color="red">审核驳回</Tag>
          ) : null}
          <Tag color={record.registrationStatus === '报名中' ? 'green' : 'orange'}>
            {record.registrationStatus}
          </Tag>
        </Space>
      ),
    },
    {
      title: '报名审核',
      key: 'counts',
      width: 180,
      render: (_: unknown, record: Competition) => (
        <Space direction="vertical" size={2}>
          <Typography.Text>待审核：{record.counts.pending}</Typography.Text>
          <Typography.Text type="secondary">已通过：{record.counts.approved}</Typography.Text>
          <Typography.Text type="secondary">已拒绝：{record.counts.rejected}</Typography.Text>
        </Space>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 520,
      render: (_: unknown, record: Competition) => (
        <Space wrap>
          <Button icon={<EditOutlined />} onClick={() => router.push('/admin/tournaments')}>
            编辑赛事
          </Button>
          {record.isArchived ? (
            isRoot ? (
              <Popconfirm title="确认恢复该归档赛事？" onConfirm={() => restoreCompetition(record)}>
                <Button icon={<UndoOutlined />}>恢复赛事</Button>
              </Popconfirm>
            ) : null
          ) : (
            <Popconfirm
              title={record.isPublished ? '确认下架该赛事？' : '确认发布该赛事？'}
              onConfirm={() => togglePublication(record)}
              disabled={!record.isPublished && record.approvalStatus !== 'APPROVED'}
            >
              <Button
                icon={record.isPublished ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
                disabled={!record.isPublished && record.approvalStatus !== 'APPROVED'}
                title={
                  !record.isPublished && record.approvalStatus !== 'APPROVED'
                    ? '需要总管理员审核通过后才能发布'
                    : undefined
                }
              >
                {record.isPublished ? '下架' : '发布'}
              </Button>
            </Popconfirm>
          )}
          <Button
            type="primary"
            icon={<AuditOutlined />}
            onClick={() => router.push(competitionPath(record, 'registrations'))}
          >
            报名审核
          </Button>
          <Button
            icon={<TeamOutlined />}
            onClick={() => router.push(competitionPath(record, 'players'))}
          >
            参赛选手
          </Button>
          <Button
            icon={<PictureOutlined />}
            onClick={() => router.push(competitionPath(record, 'watermark'))}
          >
            水印设置
          </Button>
          <Button
            icon={<PictureOutlined />}
            onClick={() => router.push(competitionPath(record, 'photos'))}
          >
            图片管理
          </Button>
          <Button
            icon={<QrcodeOutlined />}
            loading={qrLoadingId === record.id}
            onClick={() => showPhotoQrCode(record)}
          >
            {record.photoAccessEnabled ? '查看图片二维码' : '生成图片二维码'}
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>
            赛事管理
          </Typography.Title>
          <Typography.Text type="secondary">
            管理赛事发布状态，并按赛事进入独立的报名审核和参赛选手列表。
          </Typography.Text>
        </div>
        <Space>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => router.push('/admin/tournaments?create=1')}>
            新建赛事
          </Button>
          <Button icon={<EyeOutlined />} onClick={() => router.push('/competitions')}>
          查看前台赛事
          </Button>
        </Space>
      </div>
      <Table
        rowKey="id"
        columns={columns}
        dataSource={competitions}
        loading={loading}
        pagination={{ pageSize: 10 }}
      />
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
