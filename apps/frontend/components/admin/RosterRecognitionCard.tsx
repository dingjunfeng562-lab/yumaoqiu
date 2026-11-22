'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  Modal,
  Space,
  Spin,
  Switch,
  Tag,
  Typography,
  Upload,
  message,
} from 'antd';
import { ExperimentOutlined, InboxOutlined, SaveOutlined } from '@ant-design/icons';
import { apiFetch, apiUpload } from '@/lib/api';

type Config = {
  enabled: boolean;
  prompt: string;
  defaultPrompt: string;
  hasChannelKey: boolean;
  model: string;
  maxPages: number;
};

type TestResult = {
  teams: Array<{ name: string; members: Array<{ name: string; gender?: string }> }>;
  warnings: string[];
  model: string;
  elapsedMs: number;
};

const endpoint = '/admin/roster-recognition';

/**
 * 报名表识别配置：只有超级管理员看得到。
 * 复用「图片审核」的 DeepSeek 通道与 Key，但开关和提示词是独立的。
 */
export default function RosterRecognitionCard({ token }: { token?: string }) {
  const [form] = Form.useForm<{ enabled: boolean; prompt: string }>();
  const [config, setConfig] = useState<Config | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const data = await apiFetch<Config>(endpoint, { token, cache: 'no-store' });
      setConfig(data);
      form.setFieldsValue({ enabled: data.enabled, prompt: data.prompt });
    } catch (error) {
      message.error(error instanceof Error ? error.message : '报名表识别配置加载失败');
    } finally {
      setLoading(false);
    }
  }, [form, token]);

  useEffect(() => { void load(); }, [load]);

  /** 从关闭改为开启时先确认隐私说明：名单会发给第三方模型服务商。 */
  function confirmEnable() {
    return new Promise<boolean>((resolve) => {
      Modal.confirm({
        title: '开启报名表识别前请确认',
        width: 520,
        content: <Space orientation="vertical" size={6}>
          <Typography.Text>开启后，管理员上传的报名表照片和 PDF 会发送给第三方 AI 服务（{config?.model ?? '识图模型'}）识别。报名表里通常有姓名、性别、联系方式，也可能有身份证号。</Typography.Text>
          <Typography.Text>请确认赛事已告知报名人员：报名资料会交由第三方服务处理。</Typography.Text>
          <Typography.Text type="secondary">系统不保存原图；默认提示词要求不识别身份证号；识别结果只回到页面，管理员核对后才会导入。不希望名单外传的赛事请继续用 Excel 导入。</Typography.Text>
        </Space>,
        okText: '确认开启',
        cancelText: '取消',
        onOk: () => resolve(true),
        onCancel: () => resolve(false),
      });
    });
  }

  async function save() {
    if (!token) return;
    const values = await form.validateFields();
    if (values.enabled && !config?.enabled && !(await confirmEnable())) return;
    setSaving(true);
    try {
      const data = await apiFetch<Config>(endpoint, {
        method: 'PATCH',
        token,
        body: JSON.stringify({ enabled: values.enabled, prompt: values.prompt ?? '' }),
      });
      setConfig(data);
      form.setFieldsValue({ enabled: data.enabled, prompt: data.prompt });
      message.success(data.enabled ? '报名表识别已开启' : '报名表识别已关闭');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function runTest(file: File) {
    if (!token) return;
    setTesting(true);
    setTestResult(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      // 用正在编辑的提示词测试（还没保存也可以）；留空 = 内置默认提示词
      formData.append('prompt', form.getFieldValue('prompt') ?? '');
      const result = await apiUpload<TestResult>(`${endpoint}/test`, formData, { token });
      setTestResult(result);
      const people = result.teams.reduce((total, team) => total + team.members.length, 0);
      message.success(`识别完成：${result.teams.length} 个团体、${people} 人，用时 ${(result.elapsedMs / 1000).toFixed(1)} 秒`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '测试识别失败');
    } finally {
      setTesting(false);
    }
  }

  if (!config && loading) return <Card><Spin /></Card>;
  if (!config) return null;

  return (
    <Card
      title={<Space><ExperimentOutlined /><span>报名表识别（照片 / PDF）</span></Space>}
      extra={<Tag color={config.enabled ? 'green' : 'default'}>{config.enabled ? '已开启' : '已关闭'}</Tag>}
    >
      <Alert
        type={config.hasChannelKey ? 'info' : 'warning'}
        showIcon
        style={{ marginBottom: 16 }}
        title={config.hasChannelKey ? `复用「图片审核」的识图通道（${config.model}）` : '识图通道还没有 API Key'}
        description={config.hasChannelKey
          ? '密钥和接口地址沿用「图片审核」里的 DeepSeek 配置；这里只控制报名表识别的开关和提示词。识别结果不会自动入库，管理员必须核对后才能导入。'
          : '请先到「图片审核」页填写 DeepSeek API Key，再回来开启报名表识别。'}
      />

      <Form form={form} layout="vertical" disabled={saving || testing}>
        <Form.Item name="enabled" label="开启报名表识别" valuePropName="checked"
          extra="关闭后，建队页只能导入 Excel，照片和 PDF 不显示识别入口。">
          <Switch checkedChildren="开启" unCheckedChildren="关闭" />
        </Form.Item>

        <Form.Item name="prompt" label="识别提示词"
          extra="留空使用内置默认提示词；一般不需要修改。写错可能导致识别结果不可用。">
          <Input.TextArea rows={8} maxLength={4000} showCount placeholder={config.defaultPrompt} />
        </Form.Item>

        <Space wrap>
          <Button type="primary" icon={<SaveOutlined />} onClick={save} loading={saving}>保存</Button>
          <Button onClick={() => form.setFieldsValue({ prompt: '' })} disabled={saving || testing}>恢复默认提示词</Button>
          <Upload showUploadList={false} accept=".jpg,.jpeg,.png,.webp,.pdf" disabled={testing}
            beforeUpload={(file) => { void runTest(file as File); return false; }}>
            <Button icon={<InboxOutlined />} loading={testing}>上传样例测试</Button>
          </Upload>
          <Typography.Text type="secondary">测试用的是上面正在编辑的提示词，不会保存配置，也不会写入任何队员。</Typography.Text>
        </Space>
      </Form>

      {testResult ? (
        <Alert
          type={testResult.warnings.length ? 'warning' : 'success'}
          showIcon
          style={{ marginTop: 16 }}
          title={`识别到 ${testResult.teams.length} 个团体、${testResult.teams.reduce((total, team) => total + team.members.length, 0)} 人（${testResult.model}，${(testResult.elapsedMs / 1000).toFixed(1)} 秒）`}
          description={
            <Space orientation="vertical" size={4} style={{ width: '100%' }}>
              {testResult.teams.slice(0, 5).map(team => (
                <Typography.Text key={team.name}>
                  {team.name}：{team.members.map(member => member.name).join('、')}
                </Typography.Text>
              ))}
              {testResult.warnings.map((warning, index) => (
                <Typography.Text key={`${warning}-${index}`} type="warning">{warning}</Typography.Text>
              ))}
            </Space>
          }
        />
      ) : null}
    </Card>
  );
}
