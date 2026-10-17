'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Alert, Button, Card, Form, Input, Result, Space, Spin, Switch, Tag, Typography, message } from 'antd';
import { ApiOutlined, SafetyCertificateOutlined, SaveOutlined } from '@ant-design/icons';
import { apiFetch } from '@/lib/api';

type Config = { enabled: boolean; hasApiKey: boolean; modelName: string; updatedAt: string | null };
type Values = { enabled: boolean; apiKey?: string };
type TestResult = { success: boolean; message: string; latencyMs?: number };
const endpoint = '/admin/image-moderation';

export default function ImageModerationPage() {
  const { data: session } = useSession();
  const token = session?.user?.accessToken;
  const [form] = Form.useForm<Values>();
  const [config, setConfig] = useState<Config | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [reload, setReload] = useState(0);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    async function load() {
      try {
        const me = await apiFetch<{ role: string; permissions: string[] }>('/auth/me', { token });
        if (cancelled) return;
        if (me.role !== 'ROOT' && !me.permissions.includes('IMAGE_MODERATION')) {
          setForbidden(true);
          return;
        }
        setCanEdit(me.role === 'ROOT' || me.permissions.includes('IMAGE_MODERATION'));
        const saved = await apiFetch<Config>(endpoint, { token, cache: 'no-store', redirectOnForbidden: false });
        if (cancelled) return;
        setConfig(saved);
        setLoadError('');
        form.setFieldsValue({ enabled: saved.enabled, apiKey: '' });
      } catch (error) {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : '加载设置失败');
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [token, form, reload]);

  async function save(values: Values) {
    if (!token) return;
    setSaving(true);
    try {
      const saved = await apiFetch<Config>(endpoint, {
        token, method: 'PATCH', body: JSON.stringify(values),
      });
      setConfig(saved);
      form.setFieldsValue({ enabled: saved.enabled, apiKey: '' });
      setDirty(false);
      message.success(saved.enabled ? '已开启图片自动审核' : '已关闭图片自动审核');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    if (!token) return;
    try { await form.validateFields(); } catch { return; }
    setTesting(true);
    setTestResult(null);
    try {
      const result = await apiFetch<TestResult>(`${endpoint}/test`, {
        token, method: 'POST', body: JSON.stringify({ apiKey: form.getFieldValue('apiKey') || '' }),
      });
      setTestResult(result);
    } catch (error) {
      setTestResult({ success: false, message: error instanceof Error ? error.message : '测试失败' });
    } finally {
      setTesting(false);
    }
  }

  if (forbidden) return <Result status="403" title="仅超级管理员和超级管理员可查看图片审核" />;
  if (loadError) return <Result status="error" title="无法加载图片审核设置" subTitle={loadError}
    extra={<Button onClick={() => setReload((value) => value + 1)}>重新加载</Button>} />;
  if (!config) return <div style={{ padding: 48, textAlign: 'center' }}><Spin /></div>;

  return (
    <div style={{ maxWidth: 820, margin: '0 auto' }}>
      <Typography.Title level={3} style={{ marginTop: 0 }}><SafetyCertificateOutlined /> 图片审核</Typography.Title>
      <Typography.Paragraph type="secondary">
        使用 DeepSeek 自动审核新上传的赛事照片、封面和水印 Logo。具有图片审核配置权限的账号可以查看和修改。
      </Typography.Paragraph>
      <Card title="自动审核设置" extra={<Tag color={config.enabled ? 'green' : 'default'}>{config.enabled ? '已开启' : '已关闭'}</Tag>}>
        <Form form={form} layout="vertical" onFinish={save} disabled={!canEdit || saving || testing}
          onValuesChange={() => { setDirty(true); setTestResult(null); }}>
          <Form.Item name="enabled" label="是否需要图片审核" valuePropName="checked"
            extra="修改后点击保存生效。关闭后，新图片将直接上传。">
            <Switch checkedChildren="需要审核" unCheckedChildren="无需审核" />
          </Form.Item>
          <Form.Item label="审核模型"><Input value={`DeepSeek V4.1 Flash（${config.modelName}）`} readOnly /></Form.Item>
          <Form.Item name="apiKey" label="DeepSeek API Key" dependencies={['enabled']}
            extra={config.hasApiKey ? '已保存密钥；留空保留原密钥，填写新值可替换。' : '填写 DeepSeek 官方平台的 API Key，仅用于图片审核。'}
            rules={[
              { max: 512, message: 'API Key 长度不能超过 512 个字符' },
              ({ getFieldValue }) => ({ validator(_, value: string | undefined) {
                if (getFieldValue('enabled') && !config.hasApiKey && !value?.trim()) {
                  return Promise.reject(new Error('开启审核前请填写 API Key'));
                }
                return Promise.resolve();
              } }),
            ]}>
            <Input.Password autoComplete="new-password" placeholder={config.hasApiKey ? '已配置，留空不修改' : '请输入 API Key'} />
          </Form.Item>
          <Alert type="info" showIcon style={{ marginBottom: 24 }}
            title="色情内容和任何二维码均禁止上传"
            description="开启后，微信、加群、收款、赛事等二维码一律拦截，色情内容同样禁止。图片通过自动审核才会保存；无法判断或服务暂不可用时也会拦截。已有图片不自动重审，动图需转为静态图片。" />
          {testResult && <Alert type={testResult.success ? 'success' : 'error'} showIcon style={{ marginBottom: 20 }}
            title={testResult.success ? `连接成功${testResult.latencyMs ? ` · ${testResult.latencyMs}ms` : ''}` : '连接失败'}
            description={testResult.message} />}
          <Space wrap>
            <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={saving} disabled={!canEdit || testing}>保存设置</Button>
            <Button icon={<ApiOutlined />} loading={testing} disabled={!canEdit || saving} onClick={test}>测试连接</Button>
            {dirty && <Typography.Text type="warning">有未保存的修改</Typography.Text>}
          </Space>
        </Form>
        <Typography.Paragraph type="secondary" style={{ marginTop: 20, marginBottom: 0 }}>
          测试连接使用系统生成的图片，不会修改审核开关或保存密钥。
        </Typography.Paragraph>
      </Card>
    </div>
  );
}
