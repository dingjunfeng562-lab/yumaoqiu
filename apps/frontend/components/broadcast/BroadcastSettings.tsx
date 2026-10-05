'use client';

import { Card, Col, InputNumber, Row, Select, Slider, Switch, Typography } from 'antd';
import { OVERLAY_POSITIONS, type OverlaySettings } from '@/lib/broadcast-types';

type Props = {
  value: OverlaySettings;
  onChange: (next: OverlaySettings) => void;
  disabled?: boolean;
};

const toggles: { key: keyof OverlaySettings; label: string; hint?: string }[] = [
  { key: 'visible', label: '显示记分牌' },
  { key: 'showTitle', label: '显示标题行' },
  { key: 'showAffiliation', label: '显示选手单位' },
  { key: 'showGames', label: '显示各局比分' },
  { key: 'showGameWins', label: '显示局分' },
  { key: 'showServe', label: '显示发球标记' },
  { key: 'swapSides', label: '上下交换显示', hint: '姓名、单位、比分和标记一起交换' },
];

export function BroadcastSettings({ value, onChange, disabled }: Props) {
  const set = <K extends keyof OverlaySettings>(key: K, next: OverlaySettings[K]) =>
    onChange({ ...value, [key]: next });

  return (
    <Card size="small" title="记分牌样式">
      <Row gutter={[16, 12]}>
        <Col xs={24} md={8}>
          <Typography.Text type="secondary">画面位置</Typography.Text>
          <Select
            style={{ width: '100%' }}
            disabled={disabled}
            value={value.position}
            options={OVERLAY_POSITIONS.map((item) => ({ value: item.value, label: item.label }))}
            onChange={(next) => set('position', next)}
            aria-label="记分牌画面位置"
          />
        </Col>
        <Col xs={12} md={4}>
          <Typography.Text type="secondary">水平边距</Typography.Text>
          <InputNumber
            style={{ width: '100%' }} min={0} max={600} disabled={disabled}
            value={value.offsetX} onChange={(next) => set('offsetX', next ?? 0)} aria-label="水平边距"
          />
        </Col>
        <Col xs={12} md={4}>
          <Typography.Text type="secondary">垂直边距</Typography.Text>
          <InputNumber
            style={{ width: '100%' }} min={0} max={400} disabled={disabled}
            value={value.offsetY} onChange={(next) => set('offsetY', next ?? 0)} aria-label="垂直边距"
          />
        </Col>
        <Col xs={12} md={4}>
          <Typography.Text type="secondary">整体缩放 %</Typography.Text>
          <InputNumber
            style={{ width: '100%' }} min={50} max={200} disabled={disabled}
            value={value.scale} onChange={(next) => set('scale', next ?? 100)} aria-label="整体缩放"
          />
        </Col>
        <Col xs={12} md={4}>
          <Typography.Text type="secondary">字号 %</Typography.Text>
          <InputNumber
            style={{ width: '100%' }} min={70} max={160} disabled={disabled}
            value={value.fontScale} onChange={(next) => set('fontScale', next ?? 100)} aria-label="字号比例"
          />
        </Col>

        {toggles.map((item) => (
          <Col xs={12} md={6} key={item.key}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Switch
                size="small" disabled={disabled}
                checked={Boolean(value[item.key])}
                onChange={(next) => set(item.key, next as OverlaySettings[typeof item.key])}
                aria-label={item.label}
              />
              <Typography.Text>{item.label}</Typography.Text>
            </div>
            {item.hint && <Typography.Text type="secondary" style={{ fontSize: 12 }}>{item.hint}</Typography.Text>}
          </Col>
        ))}

        <Col xs={24} md={12}>
          <Typography.Text type="secondary">比分显示延迟：{value.scoreDelaySeconds} 秒</Typography.Text>
          <Slider
            min={0} max={10} step={1} disabled={disabled}
            value={value.scoreDelaySeconds}
            onChange={(next) => set('scoreDelaySeconds', next as number)}
          />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            用于让记分牌对齐视频延迟。样式改动立即生效，比分按此延迟生效。
          </Typography.Text>
        </Col>
      </Row>
    </Card>
  );
}
