'use client';

import { useState } from 'react';
import { Alert, Button, ConfigProvider, Form, InputNumber, Slider, Space, theme } from 'antd';
import { apiFetch } from '@/lib/api';
import { boardScale, screenCardFontScale, screenCardHeight, screenCardWidth, screenLayout, MAX_SCREEN_COLUMNS, type BoardViewport, type ScreenSettings } from '@/lib/screen-settings';
import styles from './TournamentScreen.module.css';

export function TournamentScreenSettings({ tournamentId, settings, defaults, courtCount, fitPercent, viewport, token, onChange, onSaved, onSavedLocally, onClose }: {
  tournamentId: string;
  settings: ScreenSettings;
  defaults: ScreenSettings;
  courtCount: number;
  /** Zoom the screen actually applied so the whole board fits, in percent. */
  fitPercent: number | null;
  viewport: BoardViewport | null;
  token?: string;
  onChange: (settings: ScreenSettings) => void;
  onSaved: (settings: ScreenSettings) => void;
  /** Used when the server refuses to store the layout for this tournament. */
  onSavedLocally: (settings: ScreenSettings) => void;
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
    } catch (reason) {
      const status = (reason as { status?: number } | null)?.status;
      // The account may watch this tournament without being allowed to manage
      // it. The layout still applies here instead of failing outright, which is
      // the same per-browser mode an anonymous screen already uses.
      if (token && (status === 403 || status === 404)) {
        onSavedLocally(settings);
        setFeedback({ error: false, text: '没有该赛事的全局设置权限，已保存在当前浏览器' });
      } else {
        setFeedback({ error: true, text: reason instanceof Error ? reason.message : '保存失败，请重试' });
      }
    }
    finally { setSaving(false); }
  }
  const layout = screenLayout(courtCount, settings, viewport);
  const crowded = fitPercent !== null && fitPercent < 45;
  // Best arrangement the display could hold with no row limit; when it beats the
  // configured limit, raising that limit is what makes the courts bigger.
  const widest = screenLayout(courtCount, { ...settings, columns: MAX_SCREEN_COLUMNS }, viewport);
  const currentScale = boardScale(courtCount, layout.columns, settings, viewport);
  const widestScale = boardScale(courtCount, widest.columns, settings, viewport);
  const gain = viewport && currentScale > 0 ? Math.round((widestScale / currentScale - 1) * 100) : 0;
  const suggestWider = widest.columns > layout.columns && gain >= 5;
  return <ConfigProvider theme={{ algorithm: theme.darkAlgorithm, token: { colorPrimary: '#70cbe4', colorBgContainer: '#132b44', colorBgElevated: '#132b44' } }}>
    <section className={styles.settingsPanel} role="dialog" aria-label="赛事大屏设置">
      <div className={styles.settingsHeader}>
        <h2>大屏设置</h2>
        <button type="button" onClick={onClose} disabled={saving} aria-label="关闭大屏设置">×</button>
      </div>
      <p className={styles.settingsHint}>调整立即预览，关闭时放弃未保存的修改。场地再多也不会翻页或裁剪：全部场地始终同屏显示，超出时整块比分板自动缩小。</p>
      <Form layout="vertical" disabled={saving}>
        <div className={styles.settingsColumns}>
          <Form.Item label="每行最多场地数" extra="上限值：屏幕在不超过该值的前提下自动选择最清晰的排列。">
            <InputNumber aria-label="每行最多场地数" min={1} max={8} precision={0} value={settings.columns} onChange={(value) => update('columns', value)} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="期望显示行数" extra="屏幕尺寸未知（首次加载前）时用于回退的排列。">
            <InputNumber aria-label="期望显示行数" min={1} max={8} precision={0} value={settings.rows} onChange={(value) => update('rows', value)} style={{ width: '100%' }} />
          </Form.Item>
        </div>
        <div className={styles.settingsColumns}>
          <Form.Item label="卡片宽度（像素）">
            <InputNumber aria-label="卡片宽度" min={240} max={1200} precision={0} value={screenCardWidth(courtCount, settings)} onChange={(value) => update('cardWidth', value)} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="卡片高度（像素）">
            <InputNumber aria-label="卡片高度" min={160} max={900} precision={0} value={screenCardHeight(courtCount, settings)} onChange={(value) => update('cardHeight', value)} style={{ width: '100%' }} />
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
            <Slider min={0} max={160} value={settings.boundaryPadding ?? 0} onChange={(value) => update('boundaryPadding', value)} />
            <InputNumber aria-label="四周边界留白" min={0} max={160} precision={0} value={settings.boundaryPadding ?? 0} onChange={(value) => update('boundaryPadding', value)} />
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
            <Slider min={50} max={200} value={screenCardFontScale(courtCount, settings)} onChange={(value) => update('cardFontScale', value)} />
            <InputNumber aria-label="卡片内字体大小" min={50} max={200} precision={0} value={screenCardFontScale(courtCount, settings)} onChange={(value) => update('cardFontScale', value)} />
          </div>
        </Form.Item>
      </Form>
      {suggestWider && <div className={styles.settingsSuggestion}>
        <span>当前屏幕每行最多可放宽到 {widest.columns} 块，画面可再放大约 {gain}%。</span>
        <Button size="small" disabled={saving} onClick={() => { onChange({ ...settings, columns: widest.columns, rows: widest.rows }); setFeedback(null); }}>用建议值</Button>
      </div>}
      <p className={styles.settingsHint}>共 {courtCount} 块场地 · 自动排列 {layout.columns} 列 × {layout.rows} 行{fitPercent !== null && <> · 当前缩放 {fitPercent}%</>}。卡片宽高固定，内部字体单独调节；文字较多时自动缩小内容避免越界。</p>
      {crowded && <Alert type="warning" title={`场地较多，比分板已自动缩放到 ${fitPercent}%，以保证全部 ${courtCount} 块场地同屏显示。可放宽“每行最多场地数”，或调小“赛事名称字号”为场地留出更多高度。`} style={{ marginBottom: 12 }} />}
      {feedback && <Alert type={feedback.error ? 'error' : 'success'} title={feedback.text} style={{ marginBottom: 12 }} />}
      <Space>
        <Button type="primary" loading={saving} onClick={save}>保存大屏设置</Button>
        <Button disabled={saving} onClick={() => { onChange(defaults); setFeedback(null); }}>恢复默认</Button>
      </Space>
      <p className={styles.settingsHint}>{token ? '保存后同步到该赛事的其他大屏。' : '保存后仅影响当前浏览器的此赛事大屏。'}</p>
    </section>
  </ConfigProvider>;
}
