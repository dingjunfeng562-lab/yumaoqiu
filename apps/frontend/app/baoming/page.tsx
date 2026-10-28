'use client';

import { useState } from 'react';
import { Alert, Button, Card, Input, Space, Typography } from 'antd';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';

type CodeInfo = {
  tournamentId: string;
  title: string;
  startDate: string;
  endDate: string;
  location?: string | null;
  registrationStatus?: string;
  entrantType: 'SCHOOL' | 'SOCIAL';
  entrantTypeLabel: string;
  loginRequired: boolean;
};

function formatDate(value?: string | null) {
  if (!value) return '待公布';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

export default function BaomingPage() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState<CodeInfo | null>(null);

  async function verify() {
    const value = code.trim();
    if (!value) {
      setError('请输入报名码');
      return;
    }
    setLoading(true);
    setError('');
    setInfo(null);
    try {
      const result = await apiFetch<CodeInfo>(`/competitions/registration-code/${encodeURIComponent(value)}`, {
        redirectOnForbidden: false,
      });
      setInfo(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : '报名码校验失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-4 py-10">
      <Card>
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <div>
            <Typography.Title level={3} style={{ marginBottom: 4 }}>
              赛事报名入口
            </Typography.Title>
            <Typography.Text type="secondary">
              输入组委会提供的报名码。学生组报名码进入学校报名，社会组报名码进入社会报名。
            </Typography.Text>
          </div>
          <Space.Compact style={{ width: '100%' }}>
            <Input
              size="large"
              value={code}
              onChange={(event) => {
                setCode(event.target.value.toUpperCase());
                setError('');
              }}
              onPressEnter={() => void verify()}
              placeholder="请输入报名码，例如 YD7K2M9Q"
              maxLength={16}
              autoFocus
            />
            <Button size="large" type="primary" loading={loading} onClick={() => void verify()}>
              验证
            </Button>
          </Space.Compact>
          {error ? <Alert type="error" showIcon message={error} /> : null}
          {info ? (
            <Alert
              type="success"
              showIcon
              message={`${info.title} · ${info.entrantTypeLabel}`}
              description={
                <Space direction="vertical" size={2}>
                  <span>
                    比赛时间：{formatDate(info.startDate)} - {formatDate(info.endDate)}
                  </span>
                  <span>比赛地点：{info.location || '待公布'}</span>
                  <span>报名状态：{info.registrationStatus || '待公布'}</span>
                  <Button
                    type="primary"
                    style={{ marginTop: 8 }}
                    onClick={() =>
                      router.push(
                        `/competitions/${info.tournamentId}/register?type=${info.entrantType.toLowerCase()}&code=${encodeURIComponent(code.trim().toUpperCase())}`,
                      )
                    }
                  >
                    {info.entrantType === 'SCHOOL' ? '填写学校报名' : '填写社会组报名'}
                  </Button>
                </Space>
              }
            />
          ) : (
            <Typography.Text type="secondary">
              报名码由赛事管理员在后台生成；如没有报名码，请联系组委会。
            </Typography.Text>
          )}
        </Space>
      </Card>
    </main>
  );
}
