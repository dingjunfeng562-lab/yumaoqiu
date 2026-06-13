'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Empty,
  Input,
  Modal,
  Popconfirm,
  Segmented,
  Space,
  Spin,
  Tag,
  Typography,
  message,
} from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined, ReloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { apiFetch } from '@/lib/api';
import { announcementPlainText } from '@/lib/announcement-html';

const SUPER_ADMIN_ROLE = 'SUPER_ADMIN';

type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

interface Tournament {
  id: string;
  name: string;
  subtitle?: string | null;
  organizer?: string | null;
  location?: string | null;
  startDate: string;
  endDate: string;
  registrationStartDate?: string | null;
  registrationEndDate?: string | null;
  description?: string | null;
  registrationNotice?: string | null;
  approvalStatus: ApprovalStatus;
  submittedById?: string | null;
  approvedById?: string | null;
  approvedAt?: string | null;
  rejectReason?: string | null;
  isPublished: boolean;
  isArchived: boolean;
  events?: Array<{ type: string }>;
  venues?: Array<{ name: string; isActive: boolean }>;
}

const TYPE_LABEL: Record<string, string> = {
  MENS_SINGLES: '男单',
  WOMENS_SINGLES: '女单',
  MENS_DOUBLES: '男双',
  WOMENS_DOUBLES: '女双',
  MIXED_DOUBLES: '混双',
};

const STATUS_META: Record<ApprovalStatus, { label: string; color: string }> = {
  PENDING: { label: '待审核', color: 'gold' },
  APPROVED: { label: '已通过', color: 'green' },
  REJECTED: { label: '已驳回', color: 'red' },
};

function formatDate(value?: string | null) {
  if (!value) return '未设置';
  const date = dayjs(value);
  return date.isValid() ? date.format('YYYY/MM/DD') : '未设置';
}

function formatDateTime(value?: string | null) {
  if (!value) return '—';
  const date = dayjs(value);
  return date.isValid() ? date.format('YYYY/MM/DD HH:mm') : '—';
}

export default function ApprovalsPage() {
  const { data: session } = useSession();
  const token = session?.user?.accessToken as string | undefined;
  const sessionRole = (session?.user as { role?: string } | undefined)?.role;

  // Re-fetch the real role from /auth/me so promotions to SUPER_ADMIN apply
  // immediately without a fresh sign-in (session JWT can be stale).
  const [liveRole, setLiveRole] = useState<string | undefined>(sessionRole);
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    apiFetch<{ role?: string }>('/auth/me', { token })
      .then((me) => {
        if (!cancelled && me?.role) setLiveRole(me.role);
      })
      .catch(() => {
        /* fall back to session role */
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const role = liveRole ?? sessionRole;
  const isSuperAdmin = role === SUPER_ADMIN_ROLE;

  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<ApprovalStatus | 'ALL'>('PENDING');
  const [reviewTarget, setReviewTarget] = useState<Tournament | null>(null);
  const [reviewReason, setReviewReason] = useState('');
  const [reviewBusy, setReviewBusy] = useState(false);

  const loadTournaments = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const data = await apiFetch<Tournament[]>('/tournaments', { token });
      setTournaments(data);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadTournaments();
  }, [loadTournaments]);

  const counts = useMemo(() => {
    const c = { PENDING: 0, APPROVED: 0, REJECTED: 0 } as Record<ApprovalStatus, number>;
    for (const t of tournaments) c[t.approvalStatus] = (c[t.approvalStatus] ?? 0) + 1;
    return c;
  }, [tournaments]);

  const filtered = useMemo(() => {
    if (filter === 'ALL') return tournaments;
    return tournaments.filter((t) => t.approvalStatus === filter);
  }, [tournaments, filter]);

  async function handleApprove(record: Tournament) {
    if (!isSuperAdmin) {
      message.error('仅总管理员可审核赛事');
      return;
    }
    try {
      await apiFetch(`/tournaments/${record.id}/approve`, { method: 'POST', token });
      message.success(`已通过:${record.name}`);
      loadTournaments();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '审核失败');
    }
  }

  async function handleReject() {
    if (!reviewTarget || !isSuperAdmin) return;
    setReviewBusy(true);
    try {
      await apiFetch(`/tournaments/${reviewTarget.id}/reject`, {
        method: 'POST',
        token,
        body: JSON.stringify({ reason: reviewReason.trim() || '未通过审核' }),
      });
      message.success(`已驳回:${reviewTarget.name}`);
      setReviewTarget(null);
      setReviewReason('');
      loadTournaments();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '驳回失败');
    } finally {
      setReviewBusy(false);
    }
  }

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: 16,
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ flex: '1 1 220px', minWidth: 0 }}>
          <Typography.Title level={4} style={{ margin: 0 }}>
            赛事审核
          </Typography.Title>
          <Typography.Text type="secondary">
            管理员新建的赛事会进入此队列,需要<Typography.Text strong>总管理员</Typography.Text>审核通过后才会向公众发布。
          </Typography.Text>
        </div>
        <Button icon={<ReloadOutlined />} onClick={loadTournaments} loading={loading}>
          刷新
        </Button>
      </div>

      {!isSuperAdmin ? (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="当前账号无审核权限"
          description="只有总管理员可以通过或驳回赛事。你可以在此查看当前审核进度。"
        />
      ) : counts.PENDING > 0 ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={`有 ${counts.PENDING} 个赛事等待你审核`}
          description='点击下方"通过审核"或"驳回"即可处理。通过后赛事会自动对公众发布。'
        />
      ) : (
        <Alert
          type="success"
          showIcon
          style={{ marginBottom: 16 }}
          message="所有赛事均已处理"
          description="当前没有待审核的赛事。"
        />
      )}

      <Segmented
        block
        style={{ marginBottom: 16 }}
        value={filter}
        onChange={(value) => setFilter(value as ApprovalStatus | 'ALL')}
        options={[
          {
            label: (
              <span>
                待审核 <Badge count={counts.PENDING} style={{ marginLeft: 6 }} />
              </span>
            ),
            value: 'PENDING',
          },
          {
            label: (
              <span>
                已通过 <Badge count={counts.APPROVED} color="#52c41a" style={{ marginLeft: 6 }} showZero />
              </span>
            ),
            value: 'APPROVED',
          },
          {
            label: (
              <span>
                已驳回 <Badge count={counts.REJECTED} color="#ff4d4f" style={{ marginLeft: 6 }} showZero />
              </span>
            ),
            value: 'REJECTED',
          },
          { label: '全部', value: 'ALL' },
        ]}
      />

      {loading && tournaments.length === 0 ? (
        <div style={{ padding: 48, textAlign: 'center' }}>
          <Spin />
        </div>
      ) : filtered.length === 0 ? (
        <Empty
          description={
            filter === 'PENDING'
              ? '当前没有待审核的赛事'
              : filter === 'APPROVED'
                ? '还没有已通过审核的赛事'
                : filter === 'REJECTED'
                  ? '没有已驳回的赛事'
                  : '没有赛事'
          }
        />
      ) : (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          {filtered.map((record) => {
            const meta = STATUS_META[record.approvalStatus];
            const events =
              record.events?.map((e) => TYPE_LABEL[e.type] ?? e.type).join(' / ') || '未设置项目';
            const venues =
              record.venues?.filter((v) => v.isActive).map((v) => v.name).join('、') || '未设置场地';

            return (
              <Card
                key={record.id}
                style={{ borderColor: record.approvalStatus === 'PENDING' ? '#faad14' : undefined }}
                styles={{ body: { padding: 16 } }}
              >
                <div
                  style={{
                    display: 'flex',
                    gap: 16,
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    flexWrap: 'wrap',
                  }}
                >
                  <div style={{ flex: '1 1 240px', minWidth: 0 }}>
                    <Space size={8} wrap>
                      <Tag color={meta.color}>{meta.label}</Tag>
                      {record.isPublished ? <Tag color="blue">已公开</Tag> : null}
                      {record.isArchived ? <Tag>已归档</Tag> : null}
                    </Space>
                    <Typography.Title level={5} style={{ margin: '8px 0 4px' }}>
                      {record.name}
                    </Typography.Title>
                    {record.subtitle ? (
                      <Typography.Text type="secondary">{record.subtitle}</Typography.Text>
                    ) : null}

                    <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
                      <FactLine label="比赛时间" value={`${formatDate(record.startDate)} → ${formatDate(record.endDate)}`} />
                      <FactLine
                        label="报名时间"
                        value={`${formatDate(record.registrationStartDate)} → ${formatDate(record.registrationEndDate)}`}
                      />
                      <FactLine label="举办单位" value={record.organizer || '未填写'} />
                      <FactLine label="比赛地点" value={record.location || '未填写'} />
                      <FactLine label="包含单项" value={events} />
                      <FactLine label="场地" value={venues} />
                    </div>

                    {record.description ? (
                      <Typography.Paragraph
                        type="secondary"
                        ellipsis={{ rows: 2, expandable: true, symbol: '展开' }}
                        style={{ marginTop: 12, marginBottom: 0 }}
                      >
                        {announcementPlainText(record.description)}
                      </Typography.Paragraph>
                    ) : null}

                    {record.approvalStatus === 'REJECTED' && record.rejectReason ? (
                      <Alert
                        type="error"
                        showIcon
                        style={{ marginTop: 12 }}
                        message="驳回原因"
                        description={record.rejectReason}
                      />
                    ) : null}

                    {record.approvalStatus === 'APPROVED' && record.approvedAt ? (
                      <Typography.Text type="secondary" style={{ display: 'block', marginTop: 12, fontSize: 12 }}>
                        于 {formatDateTime(record.approvedAt)} 审核通过
                      </Typography.Text>
                    ) : null}
                  </div>

                  {isSuperAdmin && record.approvalStatus !== 'APPROVED' && !record.isArchived ? (
                    <Space
                      direction="vertical"
                      size={8}
                      style={{ width: '100%', minWidth: 160, flex: '1 1 100%' }}
                      className="approval-actions"
                    >
                      <Popconfirm
                        title="确认通过审核?通过后将自动公开赛事"
                        onConfirm={() => handleApprove(record)}
                      >
                        <Button type="primary" size="large" icon={<CheckCircleOutlined />} block>
                          通过审核
                        </Button>
                      </Popconfirm>
                      <Button
                        danger
                        size="large"
                        icon={<CloseCircleOutlined />}
                        block
                        onClick={() => {
                          setReviewTarget(record);
                          setReviewReason('');
                        }}
                      >
                        驳回
                      </Button>
                    </Space>
                  ) : null}
                </div>
              </Card>
            );
          })}
        </Space>
      )}

      <Modal
        title={reviewTarget ? `驳回赛事 · ${reviewTarget.name}` : '驳回赛事'}
        open={reviewTarget !== null}
        onCancel={() => setReviewTarget(null)}
        onOk={handleReject}
        okText="确认驳回"
        okButtonProps={{ danger: true, loading: reviewBusy }}
        cancelText="取消"
      >
        <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
          驳回后赛事将无法对公众发布。请填写驳回原因,方便提交者修改后再申请。
        </Typography.Paragraph>
        <Input.TextArea
          rows={3}
          maxLength={200}
          showCount
          value={reviewReason}
          onChange={(event) => setReviewReason(event.target.value)}
          placeholder="例如:报名截止时间设置不合理 / 缺少场地信息..."
        />
      </Modal>
    </div>
  );
}

function FactLine({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ fontSize: 12 }}>
      <Typography.Text type="secondary" style={{ fontSize: 11 }}>
        {label}
      </Typography.Text>
      <div style={{ fontWeight: 600, marginTop: 2 }}>{value}</div>
    </div>
  );
}
