'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Alert, Button, Card, Result, Spin, Typography } from 'antd';
import { CameraOutlined, CheckCircleOutlined, ReloadOutlined } from '@ant-design/icons';
import { apiFetch } from '@/lib/api';

type UploadTarget = {
  targetType: 'TOURNAMENT' | 'ACTIVITY';
  id: string;
  name: string;
  startAt: string;
  endAt: string | null;
};

export default function PhotographerAuthorizePage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const { data: session } = useSession();
  const accessToken = session?.user?.accessToken as string | undefined;
  const [target, setTarget] = useState<UploadTarget | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!accessToken || !params.token) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    apiFetch<UploadTarget>(`/photographer/upload-access/${encodeURIComponent(params.token)}`, {
      method: 'POST', token: accessToken, body: '{}',
    })
      .then((data) => { if (!cancelled) setTarget(data); })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : '授权失败'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [accessToken, params.token, revision]);

  if (loading) return <div style={{ minHeight: 420, display: 'grid', placeItems: 'center' }}><Spin size="large" tip="正在领取上传授权" /></div>;

  if (error) return <Card style={{ maxWidth: 560, margin: '40px auto' }}><Alert type="error" showIcon title="无法获得上传授权" description={error} /><Button icon={<ReloadOutlined />} style={{ marginTop: 16 }} onClick={() => setRevision((value) => value + 1)}>重试</Button></Card>;

  return <Card style={{ maxWidth: 560, margin: '40px auto' }}>
    <Result
      status="success"
      icon={<CheckCircleOutlined />}
      title="上传授权成功"
      subTitle={<div>
        <Typography.Text strong>{target?.targetType === 'ACTIVITY' ? '活动' : '赛事'}：{target?.name}</Typography.Text>
        <br />该内容现已加入你的可上传列表。
      </div>}
      extra={<Button type="primary" size="large" icon={<CameraOutlined />} onClick={() => router.replace('/photographer/upload')}>去上传图片</Button>}
    />
  </Card>;
}
