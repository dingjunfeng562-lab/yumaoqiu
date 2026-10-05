'use client';

import { useEffect, useState } from 'react';
import { Button, Card, Empty, Progress, Spin, Typography } from 'antd';
import Link from 'next/link';
import {
  CalendarOutlined,
  DownloadOutlined,
  EyeOutlined,
  MessageOutlined,
  PictureOutlined,
} from '@ant-design/icons';
import { useSession } from 'next-auth/react';
import { apiFetch } from '@/lib/api';

type TournamentStat = {
  id: string;
  name: string;
  edition: number;
  photoCount: number;
  viewCount: number;
  downloadCount: number;
};

type UsageMetrics = {
  aiChat: number;
};

type PhotoActivityStat = {
  id: string;
  title: string;
  dateMode: 'SINGLE' | 'RANGE';
  startAt: string;
  endAt: string | null;
  approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
  photoCount: number;
};

const EMPTY_USAGE_METRICS: UsageMetrics = {
  aiChat: 0,
};

export default function AdminDashboard() {
  const { data: session } = useSession();
  const token = session?.user?.accessToken;
  // AI chat usage is platform-wide; other admins only see their own tournaments' photos.
  const isRoot = session?.user?.role === 'ROOT';
  const [stats, setStats] = useState<TournamentStat[]>([]);
  const [activityStats, setActivityStats] = useState<PhotoActivityStat[]>([]);
  const [usageMetrics, setUsageMetrics] = useState<UsageMetrics>(EMPTY_USAGE_METRICS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const [photoStats, usageStats, photoActivityStats] = await Promise.all([
          token
            ? apiFetch<TournamentStat[]>('/admin/photos/tournaments', {
                token,
                cache: 'no-store',
              }).catch(() => [])
            : Promise.resolve([]),
          token && isRoot
            ? apiFetch<UsageMetrics>('/usage-metrics/summary', { token, cache: 'no-store' }).catch(() => EMPTY_USAGE_METRICS)
            : Promise.resolve(EMPTY_USAGE_METRICS),
          token && isRoot
            ? apiFetch<PhotoActivityStat[]>('/admin/photo-activities', { token, cache: 'no-store' }).catch(() => [])
            : Promise.resolve([]),
        ]);

        if (cancelled) return;
        setStats(photoStats);
        setUsageMetrics(usageStats);
        setActivityStats(photoActivityStats);
      } catch {
        if (!cancelled) {
          setStats([]);
          setActivityStats([]);
          setUsageMetrics(EMPTY_USAGE_METRICS);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token, isRoot]);

  const totalPhotos = stats.reduce((sum, s) => sum + s.photoCount, 0);
  const totalViews = stats.reduce((sum, s) => sum + s.viewCount, 0);
  const totalDownloads = stats.reduce((sum, s) => sum + s.downloadCount, 0);
  const totalActivityPhotos = activityStats.reduce((sum, activity) => sum + activity.photoCount, 0);
  const pendingActivities = activityStats.filter((activity) => activity.approvalStatus === 'PENDING').length;
  const approvedActivities = activityStats.filter((activity) => activity.approvalStatus === 'APPROVED').length;

  const activityStatus = {
    PENDING: { color: '#d97706', label: '待审核' },
    APPROVED: { color: '#16a34a', label: '已通过' },
    REJECTED: { color: '#dc2626', label: '已驳回' },
  } as const;

  const formatActivityTime = (activity: PhotoActivityStat) => {
    const start = new Date(activity.startAt).toLocaleString('zh-CN', { hour12: false });
    if (activity.dateMode === 'SINGLE' || !activity.endAt) return start;
    return `${start} 至 ${new Date(activity.endAt).toLocaleString('zh-CN', { hour12: false })}`;
  };

  return (
    <div>
      <h1 style={{ fontSize: 24, lineHeight: 1.35, margin: '0 0 8px' }}>仪表盘</h1>
      <p style={{ color: 'rgba(0, 0, 0, 0.45)', margin: '0 0 24px' }}>
        欢迎使用羽动云赛。请从左侧菜单选择赛事、报名、抽签、裁判记分等功能。
      </p>

      {isRoot && <Card title="智能工具使用统计" style={{ marginBottom: 24 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
          <div
            style={{
              padding: 16,
              border: '1px solid #bae0ff',
              borderRadius: 8,
              background: '#f0f7ff',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#1677ff', fontSize: 13, fontWeight: 700 }}>
              <MessageOutlined /> AI 对话使用次数
            </div>
            <Typography.Title level={2} style={{ margin: '10px 0 0', color: '#1677ff' }}>
              {usageMetrics.aiChat.toLocaleString()}
            </Typography.Title>
          </div>
        </div>
      </Card>}

      <Card title="图片统计总览" style={{ marginBottom: 24 }} extra={isRoot ? (
        <Link href="/admin/image-moderation"><Button icon={<PictureOutlined />}>图片审核设置</Button></Link>
      ) : undefined}>
        <div style={{ display: 'flex', gap: 48, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ width: 80, height: 80 }}>
              <Progress
                type="circle"
                percent={stats.length > 0 ? Math.round((totalPhotos / stats.reduce((sum, s) => Math.max(sum, s.photoCount * 3), 1)) * 100) : 0}
                size={80}
                strokeColor={{
                  '0%': '#1677ff',
                  '100%': '#0958d9',
                }}
              />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#64748b', fontSize: 13 }}>
                <PictureOutlined /> 图片总数
              </div>
              <Typography.Title level={3} style={{ margin: 0, color: '#1677ff' }}>
                {totalPhotos.toLocaleString()}
              </Typography.Title>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ width: 80, height: 80 }}>
              <Progress
                type="circle"
                percent={stats.length > 0 ? Math.round((totalViews / Math.max(totalViews + totalDownloads, 1)) * 100) : 0}
                size={80}
                strokeColor={{
                  '0%': '#52c41a',
                  '100%': '#389e0d',
                }}
              />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#64748b', fontSize: 13 }}>
                <EyeOutlined /> 总浏览量
              </div>
              <Typography.Title level={3} style={{ margin: 0, color: '#52c41a' }}>
                {totalViews.toLocaleString()}
              </Typography.Title>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ width: 80, height: 80 }}>
              <Progress
                type="circle"
                percent={stats.length > 0 ? Math.round((totalDownloads / Math.max(totalViews + totalDownloads, 1)) * 100) : 0}
                size={80}
                strokeColor={{
                  '0%': '#faad14',
                  '100%': '#d48806',
                }}
              />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#64748b', fontSize: 13 }}>
                <DownloadOutlined /> 总下载量
              </div>
              <Typography.Title level={3} style={{ margin: 0, color: '#faad14' }}>
                {totalDownloads.toLocaleString()}
              </Typography.Title>
            </div>
          </div>
        </div>
      </Card>

      {isRoot && (
        <Card
          title="活动图片统计"
          style={{ marginBottom: 24 }}
          extra={<Link href="/admin/photo-activities"><Button icon={<CalendarOutlined />}>管理活动图片</Button></Link>}
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 20 }}>
            {[
              { label: '活动总数', value: activityStats.length, color: '#1677ff' },
              { label: '待审核', value: pendingActivities, color: '#d97706' },
              { label: '已通过', value: approvedActivities, color: '#16a34a' },
              { label: '活动图片总数', value: totalActivityPhotos, color: '#722ed1' },
            ].map((item) => (
              <div key={item.label} style={{ padding: 16, border: '1px solid #f0f0f0', borderRadius: 8, background: '#fafafa' }}>
                <Typography.Text type="secondary">{item.label}</Typography.Text>
                <Typography.Title level={3} style={{ margin: '4px 0 0', color: item.color }}>
                  {item.value.toLocaleString()}
                </Typography.Title>
              </div>
            ))}
          </div>

          {activityStats.length === 0 ? (
            <Empty description="暂无活动图片数据" />
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
              {activityStats.map((activity) => {
                const status = activityStatus[activity.approvalStatus];
                return (
                  <Link key={activity.id} href="/admin/photo-activities" style={{ color: 'inherit' }}>
                    <div style={{ padding: 16, border: '1px solid #f0f0f0', borderRadius: 8, background: '#fff', height: '100%' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                        <Typography.Title level={5} ellipsis style={{ margin: 0 }}>{activity.title}</Typography.Title>
                        <span style={{ color: status.color, whiteSpace: 'nowrap', fontSize: 13 }}>{status.label}</span>
                      </div>
                      <Typography.Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
                        {formatActivityTime(activity)}
                      </Typography.Text>
                      <div style={{ marginTop: 12, color: '#722ed1', fontWeight: 700 }}>
                        <PictureOutlined /> {activity.photoCount.toLocaleString()} 张图片
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </Card>
      )}

      <Card title="各赛事图片统计">
        {loading ? (
          <div style={{ textAlign: 'center', padding: 48 }}>
            <Spin />
          </div>
        ) : stats.length === 0 ? (
          <Empty description="暂无赛事图片数据" />
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
            {stats.map((stat) => (
              <div
                key={stat.id}
                style={{
                  padding: 16,
                  border: '1px solid #f0f0f0',
                  borderRadius: 8,
                  background: '#fafafa',
                }}
              >
                <div style={{ marginBottom: 16 }}>
                  <Typography.Title level={4} style={{ margin: 0 }}>
                    {stat.name}
                  </Typography.Title>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-around' }}>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ width: 70, height: 70, margin: '0 auto 8px' }}>
                      <Progress
                        type="circle"
                        percent={Math.min(100, stat.photoCount)}
                        size={70}
                        strokeColor="#1677ff"
                        format={() => stat.photoCount.toString()}
                      />
                    </div>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      图片数
                    </Typography.Text>
                  </div>

                  <div style={{ textAlign: 'center' }}>
                    <div style={{ width: 70, height: 70, margin: '0 auto 8px' }}>
                      <Progress
                        type="circle"
                        percent={Math.min(100, Math.round((stat.viewCount / Math.max(stat.viewCount + stat.downloadCount, 1)) * 100))}
                        size={70}
                        strokeColor="#52c41a"
                        format={() => stat.viewCount.toString()}
                      />
                    </div>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      浏览量
                    </Typography.Text>
                  </div>

                  <div style={{ textAlign: 'center' }}>
                    <div style={{ width: 70, height: 70, margin: '0 auto 8px' }}>
                      <Progress
                        type="circle"
                        percent={Math.min(100, Math.round((stat.downloadCount / Math.max(stat.viewCount + stat.downloadCount, 1)) * 100))}
                        size={70}
                        strokeColor="#faad14"
                        format={() => stat.downloadCount.toString()}
                      />
                    </div>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      下载量
                    </Typography.Text>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
