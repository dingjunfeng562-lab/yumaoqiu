'use client';

import { useEffect, useState } from 'react';
import { Card, Progress, Typography, Spin, Empty } from 'antd';
import { EyeOutlined, DownloadOutlined, PictureOutlined } from '@ant-design/icons';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

type TournamentStat = {
  id: string;
  name: string;
  edition: number;
  photoCount: number;
  viewCount: number;
  downloadCount: number;
};

export default function AdminDashboard() {
  const [stats, setStats] = useState<TournamentStat[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/photos/tournaments`, { cache: 'no-store' });
        const data = (res.ok ? await res.json() : []) as TournamentStat[];
        if (cancelled) return;
        setStats(data);
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const totalPhotos = stats.reduce((sum, s) => sum + s.photoCount, 0);
  const totalViews = stats.reduce((sum, s) => sum + s.viewCount, 0);
  const totalDownloads = stats.reduce((sum, s) => sum + s.downloadCount, 0);

  return (
    <div>
      <h1 style={{ fontSize: 24, lineHeight: 1.35, margin: '0 0 8px' }}>仪表板</h1>
      <p style={{ color: 'rgba(0, 0, 0, 0.45)', margin: '0 0 24px' }}>
        欢迎使用羽动云赛。请从左侧菜单选择赛事、报名、抽签、裁判记分等功能。
      </p>

      <Card title="图片统计总览" style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', gap: 48, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ width: 80, height: 80 }}>
              <Progress
                type="circle"
                percent={stats.length > 0 ? Math.round((totalPhotos / (stats.reduce((sum, s) => Math.max(sum, s.photoCount * 3), 1))) * 100) : 0}
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
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    第 {stat.edition} 届
                  </Typography.Text>
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
