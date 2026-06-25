'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Button, Card, Form, Input, Spin, Tag, Typography, message } from 'antd';
import { Header } from '@/components/home/Header';
import { apiFetch } from '@/lib/api';

const usernamePattern = /^[一-龥A-Za-z][一-龥A-Za-z0-9_-]{1,19}$/;

type Me = {
  id: string;
  username: string | null;
  email: string | null;
  name: string;
  role: string;
  renameLimit: number;
  renameUsed: number;
  renameRemaining: number;
  renameResetAt: string | null;
};

function formatDate(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

export default function AccountPage() {
  const router = useRouter();
  const { data: session, status, update } = useSession();
  const token = (session?.user as { accessToken?: string } | undefined)?.accessToken;

  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm();

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/login?redirect=/account');
    }
  }, [status, router]);

  async function loadMe() {
    if (!token) return;
    setLoading(true);
    try {
      const data = await apiFetch<Me>('/auth/me', { token });
      setMe(data);
      form.setFieldsValue({ name: data.username ?? '' });
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载账户信息失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadMe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function submitRename() {
    if (!token) return;
    let values: { name: string };
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    const nextName = values.name.trim();
    if (me && nextName === me.username) {
      message.info('新昵称与当前昵称相同');
      return;
    }
    setSubmitting(true);
    try {
      const updated = await apiFetch<Me>('/auth/me/name', {
        method: 'PATCH',
        token,
        body: JSON.stringify({ name: nextName }),
      });
      setMe(updated);
      form.setFieldsValue({ name: updated.username ?? '' });
      // Propagate the new name into the session so it shows up across the app
      // (header, dashboards) without forcing a re-login.
      await update({ name: updated.username });
      message.success('昵称修改成功');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '改名失败');
    } finally {
      setSubmitting(false);
    }
  }

  const remaining = me?.renameRemaining ?? 0;
  const canRename = remaining > 0;

  return (
    <main className="min-h-screen bg-[#f5f8ff]">
      <Header activeHref="/account" />
      <div className="mx-auto max-w-[680px] px-4 py-8">
        <Typography.Title level={3} style={{ marginBottom: 4 }}>
          账户设置
        </Typography.Title>
        <Typography.Text type="secondary">管理你的昵称等账户信息。</Typography.Text>

        <Card style={{ marginTop: 16 }} loading={loading && !me}>
          {status === 'loading' || (loading && !me) ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}>
              <Spin />
            </div>
          ) : (
            <>
              <div style={{ marginBottom: 16 }}>
                <Typography.Text type="secondary">邮箱</Typography.Text>
                <div style={{ fontWeight: 600 }}>{me?.email || '-'}</div>
              </div>

              <Typography.Title level={5} style={{ marginBottom: 8 }}>
                修改昵称
              </Typography.Title>
              <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
                每年最多可改名 <strong>{me?.renameLimit ?? 3}</strong> 次，昵称在所有用户中唯一。
                {canRename ? (
                  <Tag color="blue" style={{ marginLeft: 8 }}>
                    本年还可改名 {remaining} 次
                  </Tag>
                ) : (
                  <Tag color="red" style={{ marginLeft: 8 }}>
                    改名次数已用完{me?.renameResetAt ? `，${formatDate(me.renameResetAt)} 后恢复` : ''}
                  </Tag>
                )}
              </Typography.Paragraph>

              <Form form={form} layout="vertical">
                <Form.Item
                  name="name"
                  label="昵称"
                  rules={[
                    { required: true, message: '请输入昵称' },
                    {
                      pattern: usernamePattern,
                      message: '昵称需为 2-20 位中文、字母、数字、下划线或连字符，首字符需为中文或字母',
                    },
                  ]}
                >
                  <Input maxLength={20} disabled={!canRename} placeholder="请输入新的昵称" />
                </Form.Item>
                <Button type="primary" onClick={submitRename} loading={submitting} disabled={!canRename}>
                  保存昵称
                </Button>
              </Form>
            </>
          )}
        </Card>
      </div>
    </main>
  );
}
