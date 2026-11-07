'use client';

// 赛事统计页的图表部件：横向条形图、两组占比的分段条、数字卡片、可切换「图表/表格」的卡片。
// 配色与规格按数据可视化规范：单一系列一种颜色；条宽 16px、末端 4px 圆角、根部直角；
// 数值写在条末端；文字一律用文字色，不用系列色；每张图都有表格视图，悬停/键盘聚焦显示详情。

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Card, Segmented, Table, Tooltip, type TableColumnsType } from 'antd';

// 已用校验脚本验证（白色背景，色盲区分度与对比度均通过）。
export const SERIES = {
  school: { color: '#2a78d6', hover: '#5598e7' },
  social: { color: '#eb6834', hover: '#f08a60' },
} as const;
export type SeriesKey = keyof typeof SERIES;

const INK = { primary: 'rgba(0, 0, 0, 0.88)', secondary: '#52514e', muted: '#898781', baseline: '#c3c2b7' };
const BAR_THICKNESS = 16;
// 条末端数值标签预留的宽度，条最长也不会把标签挤出卡片。
const VALUE_RESERVE = 104;

export const formatCount = (value: number) => value.toLocaleString('zh-CN');

export type BarItem = {
  key: string;
  label: string;
  value: number;
  /** 条末端显示的文字，默认「N 人」。 */
  valueText?: string;
  /** 悬停提示里的补充说明行。 */
  details?: string[];
};

export function HorizontalBars({ items, series, labelWidth = 96, ariaLabel }: {
  items: BarItem[];
  series: SeriesKey;
  labelWidth?: number;
  ariaLabel: string;
}) {
  const [active, setActive] = useState<string | null>(null);
  const max = Math.max(1, ...items.map((item) => item.value));
  const palette = SERIES[series];

  return (
    <div role="list" aria-label={ariaLabel} style={{ display: 'grid', gap: 10 }}>
      {items.map((item) => {
        const valueText = item.valueText ?? `${formatCount(item.value)} 人`;
        const ratio = item.value / max;
        const highlighted = active === item.key;
        return (
          <Tooltip
            key={item.key}
            placement="topLeft"
            title={(
              <div style={{ lineHeight: 1.6 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{valueText}</div>
                <div style={{ opacity: 0.85 }}>{item.label}</div>
                {item.details?.map((line) => <div key={line} style={{ opacity: 0.85 }}>{line}</div>)}
              </div>
            )}
            trigger={['hover', 'focus']}
          >
            <div
              role="listitem"
              tabIndex={0}
              aria-label={`${item.label}：${valueText}`}
              onPointerEnter={() => setActive(item.key)}
              onPointerLeave={() => setActive((current) => (current === item.key ? null : current))}
              onFocus={() => setActive(item.key)}
              onBlur={() => setActive((current) => (current === item.key ? null : current))}
              style={{
                display: 'grid',
                gridTemplateColumns: `${labelWidth}px minmax(0, 1fr)`,
                alignItems: 'center',
                gap: 12,
                minHeight: 28,
                padding: '2px 4px',
                borderRadius: 6,
                outline: 'none',
                background: highlighted ? 'rgba(0, 0, 0, 0.03)' : 'transparent',
                cursor: 'default',
              }}
            >
              <span
                title={item.label}
                style={{ color: INK.secondary, fontSize: 13, textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              >
                {item.label}
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, borderLeft: `1px solid ${INK.baseline}`, height: 24 }}>
                {item.value > 0 ? (
                  <div
                    style={{
                      width: `calc((100% - ${VALUE_RESERVE}px) * ${ratio})`,
                      minWidth: 2,
                      height: BAR_THICKNESS,
                      background: highlighted ? palette.hover : palette.color,
                      borderRadius: '0 4px 4px 0',
                      transition: 'width 240ms ease, background 120ms ease',
                    }}
                  />
                ) : null}
                <span style={{ color: INK.primary, fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                  {valueText}
                </span>
              </div>
            </div>
          </Tooltip>
        );
      })}
    </div>
  );
}

/** 一个整体分成几部分（各组别）：每部分一个色块，放得下时在块内写人数。 */
export function ShareBar({ parts, ariaLabel }: {
  parts: Array<{ key: string; label: string; value: number; series: SeriesKey }>;
  ariaLabel: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const visible = parts.filter((part) => part.value > 0);
  const total = visible.reduce((sum, part) => sum + part.value, 0);
  if (!total) return null;
  const gaps = 2 * (visible.length - 1);

  return (
    <div>
      <div ref={ref} role="img" aria-label={ariaLabel} style={{ display: 'flex', gap: 2, height: 28 }}>
        {visible.map((part) => {
          const share = part.value / total;
          const text = `${formatCount(part.value)} 人`;
          // 估算文字宽度：数字约 8px、汉字约 13px，两侧各留 8px；放不下就不写，交给图例和提示。
          const fits = width > 0 && (width - gaps) * share >= text.length * 9 + 16;
          return (
            <Tooltip key={part.key} title={`${part.label}：${text}（${Math.round(share * 100)}%）`} trigger={['hover', 'focus']}>
              <div
                tabIndex={0}
                aria-label={`${part.label}：${text}，占 ${Math.round(share * 100)}%`}
                style={{
                  flex: `${part.value} 0 0`,
                  minWidth: 4,
                  background: SERIES[part.series].color,
                  borderRadius: 4,
                  display: 'flex',
                  alignItems: 'center',
                  paddingInline: 8,
                  color: '#ffffff',
                  fontSize: 13,
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                  overflow: 'visible',
                  outline: 'none',
                }}
              >
                {fits ? text : null}
              </div>
            </Tooltip>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: 16, marginTop: 8, flexWrap: 'wrap' }}>
        {visible.map((part) => (
          <span key={part.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: INK.secondary, fontSize: 13 }}>
            <span aria-hidden style={{ width: 10, height: 10, borderRadius: 2, background: SERIES[part.series].color }} />
            {part.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export function StatTile({ label, value, unit, note, style }: {
  label: string;
  value: ReactNode;
  unit?: string;
  note?: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        padding: '14px 16px',
        border: '1px solid rgba(5, 5, 5, 0.06)',
        borderRadius: 10,
        background: '#fafafa',
        minWidth: 0,
        ...style,
      }}
    >
      <div style={{ color: INK.secondary, fontSize: 13 }}>{label}</div>
      <div style={{ marginTop: 6, display: 'flex', alignItems: 'baseline', gap: 4, minWidth: 0 }}>
        <span style={{ color: INK.primary, fontSize: 28, fontWeight: 600, lineHeight: 1.2, overflowWrap: 'anywhere' }}>{value}</span>
        {unit ? <span style={{ color: INK.secondary, fontSize: 14 }}>{unit}</span> : null}
      </div>
      {note ? <div style={{ marginTop: 4, color: INK.muted, fontSize: 12, lineHeight: 1.5 }}>{note}</div> : null}
    </div>
  );
}

/** 图表卡片：右上角切换图表 / 表格，表格是图表的无障碍等价视图。 */
export function ChartCard<Row extends object>({ title, subtitle, chart, columns, rows, rowKey, extra, footer }: {
  title: string;
  subtitle?: ReactNode;
  chart: ReactNode;
  columns: TableColumnsType<Row>;
  rows: Row[];
  rowKey: (row: Row) => string;
  extra?: ReactNode;
  footer?: ReactNode;
}) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  return (
    <Card
      size="small"
      title={(
        <div style={{ padding: '4px 0' }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{title}</div>
          {subtitle ? <div style={{ color: INK.muted, fontSize: 12, fontWeight: 400 }}>{subtitle}</div> : null}
        </div>
      )}
      extra={(
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {extra}
          <Segmented
            size="small"
            value={view}
            onChange={(value) => setView(value as 'chart' | 'table')}
            options={[{ value: 'chart', label: '图表' }, { value: 'table', label: '表格' }]}
          />
        </div>
      )}
      style={{ height: '100%' }}
    >
      {view === 'chart' ? chart : (
        <Table<Row> size="small" columns={columns} dataSource={rows} rowKey={rowKey} pagination={false} />
      )}
      {footer ? <div style={{ marginTop: 12, color: INK.muted, fontSize: 12, lineHeight: 1.6 }}>{footer}</div> : null}
    </Card>
  );
}
