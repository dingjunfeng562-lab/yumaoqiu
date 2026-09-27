'use client';

import { useState } from 'react';
import { Alert, Button, ConfigProvider, Form, InputNumber, Slider, Space, theme } from 'antd';
import { apiFetch } from '@/lib/api';
import { screenLayout, type ScreenSettings } from '@/lib/screen-settings';
import styles from './TournamentScreen.module.css';

export function TournamentScreenSettings({ tournamentId, settings, defaults, courtCount, token, onChange, onSaved, onClose }: {
  tournamentId: string;
  settings: ScreenSettings;
  defaults: ScreenSettings;
  courtCount: number;
  token?: string;
  onChange: (settings: ScreenSettings) => void;
  onSaved: (settings: ScreenSettings) => void;
  onClose: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ error: boolean; text: string } | null>(null);
  function update(key: keyof ScreenSettings, value: number | null) {
    if (value !== null) { onChange({ ...settings, [key]: value }); setFeedback(null); }
  }
  async function save() {
    setSaving(true);
    setFeedback(null);
    try {
      if (token) await apiFetch('/tournaments/' + encodeURIComponent(tournamentId) + '/screen-settings', {
        token, method: 'PATCH', body: JSON.stringify(settings), redirectOnForbidden: false,
      });
      onSaved(settings);
      setFeedback({ error: false, text: token ? '已保存为赛事设置' : '已保存在当前浏览器' });
    } catch (reason) { setFeedback({ error: true, text: reason instanceof Error ? reason.message : '保存失败，请重试' }); }
    finally { setSaving(false); }
  }
  const layout = screenLayout(courtCount, settings);
  return <ConfigProvider theme={{ algorithm: theme.darkAlgorithm, token: { colorPrimary: '#70cbe4', colorBgContainer: '#132b44', colorBgElevated: '#132b44' } }}>
    <section className={styles.settingsPanel} role="dialog" aria-label="赛事大屏设置">
      <div className={styles.settingsHeader}>
        <h2>大屏设置</h2>
        <button type="button" onClick={onClose} disabled={saving} aria-label="关闭大屏设置">×</button>
      </div>
      <p className={styles.settingsHint}>调整立即预览，关闭时放弃未保存的修改。</p>
      <Form layout="vertical" disabled={saving}>
        <div className={styles.settingsColumns}>
          <Form.Item label="每行最多场地数">
            <InputNumber aria-label="每行最多场地数" min={1} max={8} precision={0} value={settings.columns} onChange={(value) => update('columns', value)} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="期望显示行数">
            <InputNumber aria-label="期望显示行数" min={1} max={8} precision={0} value={settings.rows} onChange={(value) => update('rows', value)} style={{ width: '100%' }} />
          </Form.Item>
        </div>
        <div className={styles.settingsColumns}>
          <Form.Item label="卡片宽度（像素）">
            <InputNumber aria-label="卡片宽度" min={240} max={1200} precision={0} value={settings.cardWidth ?? 560} onChange={(value) => update('cardWidth', value)} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="卡片高度（像素）">
            <InputNumber aria-label="卡片高度" min={160} max={900} precision={0} value={settings.cardHeight ?? 360} onChange={(value) => update('cardHeight', value)} style={{ width: '100%' }} />
          </Form.Item>
        </div>
        <Form.Item label="整体缩放（%）">
          <div className={styles.settingsSlider}>
            <Slider min={50} max={200} value={settings.scale} onChange={(value) => update('scale', value)} />
            <InputNumber aria-label="整体缩放" min={50} max={200} precision={0} value={settings.scale} onChange={(value) => update('scale', value)} />
          </div>
        </Form.Item>
        <Form.Item label="四周边界留白（像素）">
          <div className={styles.settingsSlider}>
            <Slider min={0} max={160} value={settings.boundaryPadding ?? 28} onChange={(value) => update('boundaryPadding', value)} />
            <InputNumber aria-label="四周边界留白" min={0} max={160} precision={0} value={settings.boundaryPadding ?? 28} onChange={(value) => update('boundaryPadding', value)} />
          </div>
        </Form.Item>
        <Form.Item label="赛事名称字号（像素）">
          <div className={styles.settingsSlider}>
            <Slider min={20} max={120} value={settings.titleFontSize} onChange={(value) => update('titleFontSize', value)} />
            <InputNumber aria-label="赛事名称字号" min={20} max={120} precision={0} value={settings.titleFontSize} onChange={(value) => update('titleFontSize', value)} />
          </div>
        </Form.Item>
        <Form.Item label="卡片内字体大小（%）">
          <div className={styles.settingsSlider}>
            <Slider min={50} max={160} value={settings.cardFontScale ?? 100} onChange={(value) => update('cardFontScale', value)} />
            <InputNumber aria-label="卡片内字体大小" min={50} max={160} precision={0} value={settings.cardFontScale ?? 100} onChange={(value) => update('cardFontScale', value)} />
          </div>
        </Form.Item>
      </Form>
      <p className={styles.settingsHint}>共 {courtCount} 块场地 · {layout.columns} 列 × {layout.rows} 行。卡片宽高固定，内部字体单独调节；文字较多时自动缩小内容避免越界。</p>
      {feedback && <Alert type={feedback.error ? 'error' : 'success'} title={feedback.text} style={{ marginBottom: 12 }} />}
      <Space>
        <Button type="primary" loading={saving} onClick={save}>保存大屏设置</Button>
        <Button disabled={saving} onClick={() => { onChange(defaults); setFeedback(null); }}>恢复默认</Button>
      </Space>
      <p className={styles.settingsHint}>{token ? '保存后同步到该赛事的其他大屏。' : '保存后仅影响当前浏览器的此赛事大屏。'}</p>
    </section>
  </ConfigProvider>;
}
