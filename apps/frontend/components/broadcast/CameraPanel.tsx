'use client';

import { useState } from 'react';
import { Alert, Button, Descriptions, Form, InputNumber, Popconfirm, Select, Space, Switch, Tag, Typography } from 'antd';
import { CameraOutlined, LinkOutlined, MobileOutlined } from '@ant-design/icons';
import { CAMERA_STATE_LABELS, type CameraInfo, type CameraSettings } from '@/lib/broadcast-types';

type Props = {
  camera: CameraInfo;
  saving: boolean;
  onPatch: (body: Record<string, unknown>, note: string) => Promise<void>;
  onPair: () => Promise<void>;
  onUnpair: () => Promise<void>;
};

/**
 * Camera app control panel. The push URL is write-only: it is submitted to the
 * server, sealed, and only the host is ever displayed back.
 *
 * Resolution and frame rate are not settable here: the phone measures its own
 * camera and encoder and picks the best 16:9 output it can sustain. The panel
 * shows what it settled on, from the heartbeat.
 */
export function CameraPanel({ camera, saving, onPatch, onPair, onUnpair }: Props) {
  const [settings, setSettings] = useState<CameraSettings>(camera.settings);

  const state = camera.state;
  const online = camera.online;
  const dirty = JSON.stringify(settings) !== JSON.stringify(camera.settings);

  const statusTag = !camera.paired
    ? <Tag>未配对</Tag>
    : online
      ? <Tag color="green">在线 · {state ? CAMERA_STATE_LABELS[state.state] : '已连接'}</Tag>
      : <Tag color="default">离线</Tag>;

  return (
    <Space orientation="vertical" size={12} style={{ width: '100%' }}>
      <Space wrap align="center">
        <Typography.Text strong><MobileOutlined /> 手机摄像端</Typography.Text>
        {statusTag}
        {camera.hasIngestUrl && (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            <LinkOutlined /> 系统自动推流到本站（无需填写地址）
          </Typography.Text>
        )}
      </Space>

      {online && state && (
        <Descriptions size="small" column={4} bordered>
          <Descriptions.Item label="分辨率">
            {state.width && state.height ? `${state.width}×${state.height}` : '—'}
          </Descriptions.Item>
          <Descriptions.Item label="帧率">{state.fps ? `${state.fps} 帧` : '—'}</Descriptions.Item>
          <Descriptions.Item label="码率">{state.bitrateKbps ? `${state.bitrateKbps} kbps` : '—'}</Descriptions.Item>
          <Descriptions.Item label="变焦">{state.zoom ? `${state.zoom}×` : '—'}</Descriptions.Item>
          <Descriptions.Item label="收音">{state.audioSource || '手机自带麦克风'}</Descriptions.Item>
          <Descriptions.Item label="电量">{state.battery != null ? `${state.battery}%` : '—'}</Descriptions.Item>
          <Descriptions.Item label="上报时间" span={2}>
            {state.at ? new Date(state.at).toLocaleTimeString() : '—'}
          </Descriptions.Item>
          {state.message && (
            <Descriptions.Item label="提示" span={4}>{state.message}</Descriptions.Item>
          )}
        </Descriptions>
      )}


      <Space wrap>
        {camera.paired ? (
          // Re-pairing rotates the token and the stream path: the phone that is
          // connected now drops off at once and has to scan again.
          <Popconfirm
            title="重新生成配对码？"
            description={online
              ? '当前手机正在连接，生成后它会立即断开、停止推流，必须用新二维码重新扫码。'
              : '旧的配对码会失效，手机需要用新二维码重新扫码。'}
            okText="重新生成" cancelText="取消"
            onConfirm={() => void onPair()}
          >
            <Button icon={<CameraOutlined />} loading={saving}>重新生成配对码</Button>
          </Popconfirm>
        ) : (
          <Button type="primary" icon={<CameraOutlined />} onClick={() => void onPair()} loading={saving}>
            生成配对码
          </Button>
        )}
        {camera.paired && (
          <Popconfirm
            title="解除配对？"
            description="手机 App 将立即停止推流，需要重新扫码。"
            onConfirm={() => void onUnpair()}
          >
            <Button danger>解除配对</Button>
          </Popconfirm>
        )}
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          配对码只在生成时显示一次；推流地址由系统自动下发，手机无需手动填写。
        </Typography.Text>
      </Space>

      <Form layout="vertical" size="small">
        <Space wrap align="end">
          <Form.Item
            label="视频码率上限(kbps)" style={{ marginBottom: 0 }}
            extra="0 = 不限，由手机按所选画质自动匹配"
          >
            <InputNumber
              min={0} max={50000} step={500} style={{ width: 140 }}
              value={settings.videoBitrateKbps}
              onChange={(value) => setSettings((current) => ({ ...current, videoBitrateKbps: value ?? 0 }))}
            />
          </Form.Item>
          <Form.Item label="音频码率(kbps)" style={{ marginBottom: 0 }}>
            <InputNumber
              min={64} max={320} step={32} style={{ width: 120 }}
              value={settings.audioBitrateKbps}
              onChange={(value) => setSettings((current) => ({ ...current, audioBitrateKbps: value ?? 128 }))}
            />
          </Form.Item>
          <Form.Item label="默认摄像头" style={{ marginBottom: 0 }}>
            <Select
              style={{ width: 110 }}
              value={settings.facing}
              options={[{ value: 'back', label: '后置' }, { value: 'front', label: '前置' }]}
              onChange={(value) => setSettings((current) => ({ ...current, facing: value }))}
            />
          </Form.Item>
          <Form.Item label="优先外接麦克风" style={{ marginBottom: 0 }}>
            <Switch
              checked={settings.preferExternalMic}
              onChange={(value) => setSettings((current) => ({ ...current, preferExternalMic: value }))}
            />
          </Form.Item>
          <Button
            type="primary" disabled={!dirty} loading={saving}
            onClick={() => void onPatch({ cameraSettings: settings }, '摄像参数已保存')}
          >
            保存参数
          </Button>
          <Button disabled={!dirty} onClick={() => setSettings(camera.settings)}>放弃改动</Button>
        </Space>
      </Form>

      <Alert
        type="info" showIcon
        message="手机端操作：安装 App → 扫描配对二维码 → 点红色开始推流。画质由手机按自身摄像头与编码器自动选择（固定 16:9），码率随之自动匹配，无需在此设置；只有场地上行带宽不够时，才用「视频码率上限」压住它。后台先显示 16:9 私有预览，确认画面和声音无误后，再点“确认发布给观众”。"
      />
    </Space>
  );
}
