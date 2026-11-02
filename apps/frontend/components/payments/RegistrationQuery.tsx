'use client';

import { useState } from 'react';
import { Alert, Button, Card, Form, Input, Space, Typography } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { apiFetch } from '@/lib/api';
import type { PaymentGroupView } from '@/lib/payments';
import { PaymentGroupList } from './PaymentGroups';

type LookupResult = { name: string; contact: string; groups: PaymentGroupView[] };

export function RegistrationQuery() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<LookupResult | null>(null);
  const [error, setError] = useState('');

  async function search(values: { name: string; contact: string }) {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ name: values.name.trim(), contact: values.contact.trim() });
      setResult(await apiFetch<LookupResult>(`/payments/lookup?${params}`, { redirectOnForbidden: false, cache: 'no-store' }));
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : '查询失败，请稍后再试');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Space orientation="vertical" size={20} style={{ width: '100%' }}>
      <Card>
        <Form layout="inline" onFinish={search} style={{ rowGap: 12 }}>
          <Form.Item name="name" rules={[{ required: true, whitespace: true, message: '请输入姓名' }]}>
            <Input placeholder="姓名" maxLength={50} style={{ width: 200 }} allowClear />
          </Form.Item>
          <Form.Item name="contact" rules={[{ required: true, whitespace: true, message: '请输入联系方式' }]}>
            <Input placeholder="联系方式 / 电话号码" maxLength={50} style={{ width: 240 }} allowClear />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" icon={<SearchOutlined />} loading={loading}>查询</Button>
          </Form.Item>
        </Form>
        <Typography.Text type="secondary" style={{ display: 'block', marginTop: 12, fontSize: 12 }}>
          姓名需与报名时一致；联系方式填写报名时留的电话，空格和横线不影响查询。双打和团体赛队员用自己的姓名和电话也能查到。
        </Typography.Text>
      </Card>

      {error ? <Alert type="error" showIcon title={error} /> : null}

      {result ? (
        <Space orientation="vertical" size={12} style={{ width: '100%' }}>
          <Typography.Text>
            查询人：<Typography.Text strong>{result.name}</Typography.Text>　联系方式：<Typography.Text strong>{result.contact}</Typography.Text>
          </Typography.Text>
          <PaymentGroupList groups={result.groups} emptyText="没有找到报名记录，请确认姓名和联系方式与报名时一致" />
        </Space>
      ) : null}
    </Space>
  );
}
