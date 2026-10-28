'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Alert, Button, Card, Descriptions, Input, Space, Tag, Typography } from 'antd';
import { apiFetch } from '@/lib/api';

type RegistrationView = {
  id: string;
  entrantTypeLabel: string;
  name: string;
  school: string;
  contact: string;
  guest: boolean;
  statusLabel: string;
  rejectReason?: string | null;
  createdAt: string;
  eventSummary: string;
  items: Array<{ id: string; eventName: string; partnerName?: string | null }>;
};

const STATUS_COLOR: Record<string, string> = {
  待审核: 'orange',
  已通过: 'green',
  已拒绝: 'red',
  已移除: 'default',
};

export default function RegistrationStatusPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const [token, setToken] = useState('');
  const [input, setInput] = useState('');
  const [data, setData] = useState<RegistrationView | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get('token') ?? '';
    if (value) {
      setToken(value);
      setInput(value);
    }
  }, []);

  const load = useCallback(async (value: string) => {
    if (!id || !value.trim()) return;
    setLoading(true);
    setError('');
    try {
      const result = await apiFetch<RegistrationView>(
        `/competitions/${id}/public-registration/${encodeURIComponent(value.trim())}`,
        { redirectOnForbidden: false },
      );
      setData(result);
    } catch (err) {
      setData(null);
      setError(err instanceof Error ? err.message : '查询失败');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (token) void load(token);
  }, [token, load]);

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <Card>
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <div>
            <Typography.Title level={3} style={{ marginBottom: 4 }}>
              报名状态查询
            </Typography.Title>
            <Typography.Text type="secondary">
              社会组报名凭报名编号查询；编号在提交成功页只显示一次，请妥善保存。
            </Typography.Text>
          </div>
          <Space.Compact style={{ width: '100%' }}>
            <Input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="请输入报名编号"
              onPressEnter={() => {
                setToken(input);
                void load(input);
              }}
            />
            <Button
              type="primary"
              loading={loading}
              onClick={() => {
                setToken(input);
                void load(input);
              }}
            >
              查询
            </Button>
          </Space.Compact>
          {error ? <Alert type="error" showIcon message={error} /> : null}
          {data ? (
            <>
              <Descriptions column={1} bordered size="small">
                <Descriptions.Item label="报名组别">{data.entrantTypeLabel}</Descriptions.Item>
                <Descriptions.Item label="姓名">{data.name}</Descriptions.Item>
                <Descriptions.Item label="单位">{data.school || '-'}</Descriptions.Item>
                <Descriptions.Item label="联系方式">{data.contact || '-'}</Descriptions.Item>
                <Descriptions.Item label="报名项目">{data.eventSummary || '-'}</Descriptions.Item>
                <Descriptions.Item label="状态">
                  <Tag color={STATUS_COLOR[data.statusLabel] ?? 'default'}>{data.statusLabel}</Tag>
                </Descriptions.Item>
                <Descriptions.Item label="提交时间">
                  {new Date(data.createdAt).toLocaleString('zh-CN', { hour12: false })}
                </Descriptions.Item>
              </Descriptions>
              {data.rejectReason ? (
                <Alert type="warning" showIcon message={`驳回原因：${data.rejectReason}`} />
              ) : null}
              <Typography.Text type="secondary">
                如需修改报名信息，请联系组委会。
              </Typography.Text>
            </>
          ) : null}
        </Space>
      </Card>
    </main>
  );
}
