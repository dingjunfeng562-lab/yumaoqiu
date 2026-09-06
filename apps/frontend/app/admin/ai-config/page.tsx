'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Divider,
  Form,
  Input,
  InputNumber,
  Result,
  Row,
  Select,
  Space,
  Spin,
  Switch,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  ApiOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  KeyOutlined,
  LoadingOutlined,
  MessageOutlined,
  ReloadOutlined,
  SaveOutlined,
  SearchOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { apiFetch } from '@/lib/api';

type AiConfigResponse = {
  id: string;
  provider: string;
  modelName: string;
  apiBase: string;
  systemPrompt: string;
  maxTokens: number;
  temperature: number;
  enabled: boolean;
  welcomeMessage: string;
  hasApiKey: boolean;
  apiKeyMasked: string;
  updatedAt: string;
};

type AiConfigFormValues = {
  provider: string;
  modelName: string;
  apiBase: string;
  apiKey?: string;
  systemPrompt: string;
  maxTokens: number;
  temperature: number;
  enabled: boolean;
  welcomeMessage: string;
};

const PROVIDER_OPTIONS = [
  { value: 'openai', label: 'OpenAI / OpenAI 兼容' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'qwen', label: '通义千问' },
  { value: 'zhipu', label: '智谱 GLM' },
  { value: 'moonshot', label: 'Moonshot' },
  { value: 'agnes', label: 'Agnes AI' },
  { value: 'custom', label: '自定义' },
];

const PROVIDER_PRESETS: Record<string, Pick<AiConfigFormValues, 'apiBase' | 'modelName'>> = {
  openai: { apiBase: 'https://api.openai.com/v1', modelName: 'gpt-4o-mini' },
  deepseek: { apiBase: 'https://api.deepseek.com/v1', modelName: 'deepseek-chat' },
  qwen: {
    apiBase: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    modelName: 'qwen-plus',
  },
  zhipu: { apiBase: 'https://open.bigmodel.cn/api/paas/v4', modelName: 'glm-4-flash' },
  moonshot: { apiBase: 'https://api.moonshot.cn/v1', modelName: 'moonshot-v1-8k' },
  agnes: { apiBase: 'https://apihub.agnes-ai.com/v1', modelName: 'agnes-2.0-flash' },
  custom: { apiBase: '', modelName: '' },
};

function normalizeConfigForForm(config: AiConfigResponse): AiConfigFormValues {
  return {
    provider: config.provider,
    modelName: config.modelName,
    apiBase: config.apiBase,
    apiKey: '',
    systemPrompt: config.systemPrompt,
    maxTokens: config.maxTokens,
    temperature: config.temperature,
    enabled: config.enabled,
    welcomeMessage: config.welcomeMessage,
  };
}

type TestResult = {
  success: boolean;
  message: string;
  model: string;
  latencyMs?: number;
  totalTokens?: number;
  reply?: string;
  provider?: string;
};

export default function AdminAiConfigPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const token = session?.user?.accessToken as string | undefined;
  const sessionRole = (session?.user as { role?: string } | undefined)?.role;
  const [liveRole, setLiveRole] = useState<string | undefined>(sessionRole);
  const [roleChecked, setRoleChecked] = useState(false);
  const [config, setConfig] = useState<AiConfigResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [fetchedModels, setFetchedModels] = useState<string[]>([]);
  const [form] = Form.useForm<AiConfigFormValues>();

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    apiFetch<{ role?: string }>('/auth/me', { token })
      .then((me) => {
        if (cancelled) return;
        if (me?.role) setLiveRole(me.role);
        setRoleChecked(true);
      })
      .catch(() => {
        if (!cancelled) setRoleChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const role = liveRole ?? sessionRole;
  const allowed = role === 'ROOT' || role === 'SUPER_ADMIN';

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const data = await apiFetch<AiConfigResponse>('/admin/ai-config', { token });
      setConfig(data);
      form.setFieldsValue(normalizeConfigForForm(data));
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'AI 配置加载失败');
    } finally {
      setLoading(false);
    }
  }, [form, token]);

  useEffect(() => {
    if (!token || !roleChecked || !allowed) return;
    void load();
  }, [allowed, load, roleChecked, token]);

  const selectedProvider = Form.useWatch('provider', form);
  const selectedPreset = useMemo(
    () => PROVIDER_PRESETS[selectedProvider || 'custom'],
    [selectedProvider],
  );

  function applyProviderPreset() {
    if (!selectedPreset) return;
    form.setFieldsValue({
      apiBase: selectedPreset.apiBase,
      modelName: selectedPreset.modelName,
    });
  }

  async function save() {
    if (!token) return;
    const values = await form.validateFields();
    const payload: Partial<AiConfigFormValues> = { ...values };
    if (!payload.apiKey?.trim()) {
      delete payload.apiKey;
    }

    setSaving(true);
    try {
      const data = await apiFetch<AiConfigResponse>('/admin/ai-config', {
        method: 'PATCH',
        token,
        body: JSON.stringify(payload),
      });
      setConfig(data);
      form.setFieldsValue(normalizeConfigForForm(data));
      message.success('AI 助手配置已保存');
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'AI 配置保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function testConnection() {
    if (!token) return;
    const values = await form.validateFields();
    const payload: Partial<AiConfigFormValues> = { ...values };

    setTesting(true);
    setTestResult(null);
    try {
      const result = await apiFetch<TestResult>('/admin/ai-config/test', {
        method: 'POST',
        token,
        body: JSON.stringify(payload),
      });
      setTestResult(result);
      if (result.success) {
        message.success(`连接测试成功 — 模型 ${result.model}，延迟 ${result.latencyMs}ms`);
      } else {
        message.error(`连接测试失败 — ${result.message}`);
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : '测试请求失败';
      setTestResult({ success: false, message: errMsg, model: values.modelName ?? '' });
      message.error(errMsg);
    } finally {
      setTesting(false);
    }
  }

  async function fetchModels() {
    if (!token) return;
    const values = await form.validateFields(['apiBase', 'apiKey']);
    const payload: Partial<AiConfigFormValues> = {
      apiBase: values.apiBase,
      apiKey: values.apiKey || undefined,
    };

    setFetchingModels(true);
    try {
      const result = await apiFetch<{ success: boolean; message: string; models: string[] }>(
        '/admin/ai-config/models',
        {
          method: 'POST',
          token,
          body: JSON.stringify(payload),
        },
      );
      if (result.success && result.models.length > 0) {
        setFetchedModels(result.models);
        // Auto-select the first model if current field is empty or not in the list
        const currentModel = form.getFieldValue('modelName');
        if (!currentModel || !result.models.includes(currentModel)) {
          form.setFieldsValue({ modelName: result.models[0] });
        }
        message.success(result.message);
      } else {
        message.error(result.message || '获取模型列表失败');
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : '获取模型列表失败');
    } finally {
      setFetchingModels(false);
    }
  }

  if (status === 'loading' || (token && !roleChecked)) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}>
        <Spin />
      </div>
    );
  }

  if (!token) {
    return (
      <Result
        status="403"
        title="请先登录"
        subTitle="登录管理员账号后才能配置 AI 助手。"
        extra={
          <Button type="primary" onClick={() => router.push('/login?redirect=/admin/ai-config')}>
            去登录
          </Button>
        }
      />
    );
  }

  if (!allowed) {
    return (
      <Result
        status="403"
        title="无权访问"
        subTitle="AI 助手配置仅总管理员和超级管理员可操作。"
        extra={
          <Button type="primary" onClick={() => router.push('/admin')}>
            返回仪表板
          </Button>
        }
      />
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          <MessageOutlined style={{ marginRight: 8 }} />
          AI 助手配置
        </Typography.Title>
        <Typography.Text type="secondary">
          设置首页羽毛球 AI 的模型、接口、密钥和欢迎语。
        </Typography.Text>
      </div>

      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Alert
          type={config?.enabled ? 'success' : 'warning'}
          showIcon
          message={
            <Space wrap>
              <span>首页 AI 助手{config?.enabled ? '已启用' : '已关闭'}</span>
              {config?.hasApiKey ? (
                <Tag color="green">Key 已保存：{config.apiKeyMasked}</Tag>
              ) : (
                <Tag color="red">尚未配置 API Key</Tag>
              )}
            </Space>
          }
          description="API Key 只会在服务端保存，前台聊天窗口不会读取或展示。"
        />

        {/* 连接测试结果 */}
        {testResult && (
          <Alert
            type={testResult.success ? 'success' : 'error'}
            showIcon
            icon={testResult.success ? <CheckCircleOutlined /> : <CloseCircleOutlined />}
            message={
              <Space wrap>
                <span>
                  {testResult.success ? '模型可用' : '模型不可用'}
                  {testResult.model ? ` — ${testResult.model}` : ''}
                </span>
                {testResult.latencyMs != null && (
                  <Tag color={testResult.latencyMs < 3000 ? 'green' : testResult.latencyMs < 8000 ? 'orange' : 'red'}>
                    延迟 {testResult.latencyMs}ms
                  </Tag>
                )}
                {testResult.totalTokens != null && testResult.totalTokens > 0 && (
                  <Tag>Token: {testResult.totalTokens}</Tag>
                )}
              </Space>
            }
            description={testResult.message}
            closable
            onClose={() => setTestResult(null)}
            style={testResult.success ? undefined : { borderColor: '#ffccc7', background: '#fff2f0' }}
          />
        )}

        <Form
          form={form}
          layout="vertical"
          disabled={loading}
          initialValues={{
            provider: 'openai',
            modelName: 'gpt-4o-mini',
            apiBase: 'https://api.openai.com/v1',
            maxTokens: 2048,
            temperature: 0.7,
            enabled: true,
          }}
        >
          <Row gutter={[16, 16]}>
            <Col xs={24} lg={12}>
              <Card
                title={
                  <Space>
                    <ApiOutlined />
                    <span>模型与接口</span>
                  </Space>
                }
                extra={
                  <Space>
                    <Button
                      icon={testing ? <LoadingOutlined /> : <ThunderboltOutlined />}
                      onClick={testConnection}
                      loading={testing}
                      type="dashed"
                    >
                      测试连接
                    </Button>
                    <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>
                      刷新
                    </Button>
                    <Button type="primary" icon={<SaveOutlined />} onClick={save} loading={saving}>
                      保存
                    </Button>
                  </Space>
                }
              >
                <Form.Item name="enabled" label="首页 AI 助手" valuePropName="checked">
                  <Switch checkedChildren="启用" unCheckedChildren="关闭" />
                </Form.Item>

                <Form.Item
                  name="provider"
                  label="服务商"
                  rules={[{ required: true, message: '请选择服务商' }]}
                >
                  <Select options={PROVIDER_OPTIONS} />
                </Form.Item>

                <Space style={{ marginTop: -8, marginBottom: 16 }}>
                  <Button size="small" onClick={applyProviderPreset}>
                    应用推荐接口
                  </Button>
                  <Typography.Text type="secondary">
                    会填入接口地址和示例模型名，可再手动修改。
                  </Typography.Text>
                </Space>

                <Form.Item
                  name="modelName"
                  label="模型名称"
                  rules={[{ required: true, message: '请输入或选择模型名称' }]}
                >
                  <Select
                    showSearch
                    allowClear
                    placeholder="手动输入或获取模型列表"
                    maxLength={128}
                    filterOption={(input, option) =>
                      (option?.value as string)?.toLowerCase().includes(input.toLowerCase())
                    }
                    options={fetchedModels.map((m) => ({ value: m, label: m }))}
                    loading={fetchingModels}
                    notFoundContent={fetchingModels ? '正在获取...' : fetchedModels.length === 0 ? '点击右侧按钮获取模型列表' : '无匹配结果'}
                    onClear={() => form.setFieldsValue({ modelName: '' })}
                  />
                </Form.Item>

                <Space style={{ marginTop: -12, marginBottom: 16 }}>
                  <Button
                    size="small"
                    icon={fetchingModels ? <LoadingOutlined /> : <SearchOutlined />}
                    onClick={fetchModels}
                    loading={fetchingModels}
                  >
                    获取模型列表
                  </Button>
                  <Typography.Text type="secondary">
                    根据填写的 API 地址和 Key 自动获取可用模型。
                  </Typography.Text>
                </Space>

                <Form.Item
                  name="apiBase"
                  label="API Base URL"
                  rules={[{ required: true, message: '请输入 API Base URL' }]}
                >
                  <Input placeholder="https://api.example.com/v1" maxLength={512} />
                </Form.Item>

                <Form.Item
                  name="maxTokens"
                  label="最大回复 Token"
                  rules={[{ required: true, message: '请输入最大回复 Token' }]}
                >
                  <InputNumber min={256} max={8192} step={256} style={{ width: '100%' }} />
                </Form.Item>

                <Form.Item
                  name="temperature"
                  label="创造性 Temperature"
                  rules={[{ required: true, message: '请输入 Temperature' }]}
                >
                  <InputNumber min={0} max={2} step={0.1} style={{ width: '100%' }} />
                </Form.Item>
              </Card>
            </Col>

            <Col xs={24} lg={12}>
              <Card
                title={
                  <Space>
                    <KeyOutlined />
                    <span>密钥与话术</span>
                  </Space>
                }
              >
                <Form.Item name="apiKey" label="API Key">
                  <Input.Password
                    placeholder={
                      config?.hasApiKey ? '留空则继续使用已保存的 Key' : '请输入 API Key'
                    }
                    maxLength={512}
                  />
                </Form.Item>

                <Form.Item
                  name="welcomeMessage"
                  label="欢迎语"
                  rules={[{ required: true, message: '请输入欢迎语' }]}
                >
                  <Input.TextArea rows={3} maxLength={500} showCount />
                </Form.Item>

                <Form.Item
                  name="systemPrompt"
                  label="系统提示词"
                  tooltip="留空则使用默认提示词"
                >
                  <Input.TextArea rows={9} maxLength={4000} showCount />
                </Form.Item>

                <Divider />
                <Space>
                  <Button type="primary" icon={<SaveOutlined />} onClick={save} loading={saving}>
                    保存配置
                  </Button>
                  <Typography.Text type="secondary">
                    修改后首页聊天窗口刷新即可使用新配置。
                  </Typography.Text>
                </Space>
              </Card>
            </Col>
          </Row>
        </Form>
      </Space>
    </div>
  );
}
