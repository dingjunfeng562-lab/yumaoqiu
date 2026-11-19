'use client';

import { Button, Input, Segmented, Select, Space, Tag, Typography } from 'antd';
import { AppstoreOutlined, ClusterOutlined, SearchOutlined, UnorderedListOutlined } from '@ant-design/icons';
import { EMPTY_FILTERS, STATUS_TABS, hasActiveFilters, type MatchFilters, type StatusTab } from '@/lib/match-management';

const { Text } = Typography;

export type ViewMode = 'court' | 'list' | 'bracket';
type Option = { value: string; label: string };

/**
 * 状态标签（带数量，点了就筛选）+ 筛选条（搜索、项目、场地、裁判、日期、视图切换）+ 已选条件小标签。
 * 状态标签上的数字是整个赛事的数，不随其它筛选变化。
 */
export function MatchToolbar({
  counts,
  filters,
  onChange,
  projectOptions,
  venueOptions,
  refereeOptions,
  dateOptions,
  viewMode,
  onViewModeChange,
  shown,
}: {
  counts: Record<StatusTab, number>;
  filters: MatchFilters;
  onChange: (next: MatchFilters) => void;
  projectOptions: Option[];
  venueOptions: Option[];
  refereeOptions: Option[];
  dateOptions: Option[];
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  shown: number;
}) {
  const set = (patch: Partial<MatchFilters>) => onChange({ ...filters, ...patch });
  const label = (options: Option[], value: string) => options.find((option) => option.value === value)?.label ?? value;
  const chips: Array<{ key: string; text: string; remove: () => void }> = [
    ...(filters.keyword.trim() ? [{ key: 'keyword', text: `搜索：${filters.keyword.trim()}`, remove: () => set({ keyword: '' }) }] : []),
    ...filters.projects.map((value) => ({ key: `p:${value}`, text: label(projectOptions, value), remove: () => set({ projects: filters.projects.filter((item) => item !== value) }) })),
    ...filters.venues.map((value) => ({ key: `v:${value}`, text: label(venueOptions, value), remove: () => set({ venues: filters.venues.filter((item) => item !== value) }) })),
    ...filters.referees.map((value) => ({ key: `r:${value}`, text: `裁判 ${label(refereeOptions, value)}`, remove: () => set({ referees: filters.referees.filter((item) => item !== value) }) })),
    ...filters.dates.map((value) => ({ key: `d:${value}`, text: label(dateOptions, value), remove: () => set({ dates: filters.dates.filter((item) => item !== value) }) })),
  ];

  return (
    <div style={{ marginTop: 16, background: '#fff', border: '1px solid #f0f0f0', borderRadius: 8, padding: '12px 16px' }}>
      <div role="tablist" aria-label="按状态筛选" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {STATUS_TABS.filter((tab) => tab.key !== 'CANCELLED' || counts.CANCELLED > 0).map((tab) => {
          const active = filters.tab === tab.key;
          const warn = tab.key === 'ATTENTION' && counts.ATTENTION > 0;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => set({ tab: tab.key })}
              style={{
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'baseline',
                gap: 6,
                padding: '6px 14px',
                borderRadius: 999,
                border: `1px solid ${active ? (warn ? '#dc2626' : '#1677ff') : warn ? '#fecaca' : '#e2e8f0'}`,
                background: active ? (warn ? '#dc2626' : '#1677ff') : warn ? '#fef2f2' : '#fff',
                color: active ? '#fff' : warn ? '#b91c1c' : '#334155',
                fontWeight: 700,
                fontSize: 13,
              }}
            >
              {tab.key === 'ATTENTION' ? `⚠ ${tab.label}` : tab.label}
              <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 800 }}>{counts[tab.key]}</span>
            </button>
          );
        })}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 12 }}>
        <Input
          allowClear
          prefix={<SearchOutlined />}
          placeholder="搜场次号 / 选手 / 单位 / 裁判 / 场地"
          style={{ width: 'min(300px, 100%)' }}
          value={filters.keyword}
          onChange={(event) => set({ keyword: event.target.value })}
        />
        <Select mode="multiple" allowClear maxTagCount="responsive" placeholder="项目" style={{ minWidth: 150, maxWidth: 260 }}
          value={filters.projects} options={projectOptions} onChange={(value) => set({ projects: value })} optionFilterProp="label" />
        <Select mode="multiple" allowClear maxTagCount="responsive" placeholder="场地" style={{ minWidth: 120, maxWidth: 220 }}
          value={filters.venues} options={venueOptions} onChange={(value) => set({ venues: value })} optionFilterProp="label" />
        <Select mode="multiple" allowClear maxTagCount="responsive" placeholder="裁判" style={{ minWidth: 120, maxWidth: 220 }}
          value={filters.referees} options={refereeOptions} onChange={(value) => set({ referees: value })} optionFilterProp="label" />
        <Select mode="multiple" allowClear maxTagCount="responsive" placeholder="日期" style={{ minWidth: 120, maxWidth: 220 }}
          value={filters.dates} options={dateOptions} onChange={(value) => set({ dates: value })} />
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>显示 {shown} 场</Text>
          <Segmented
            value={viewMode}
            onChange={(value) => onViewModeChange(value as ViewMode)}
            options={[
              { value: 'court', label: '场地', icon: <AppstoreOutlined /> },
              { value: 'list', label: '列表', icon: <UnorderedListOutlined /> },
              { value: 'bracket', label: '对阵表', icon: <ClusterOutlined /> },
            ]}
          />
        </div>
      </div>

      {chips.length ? (
        <Space wrap size={6} style={{ marginTop: 10 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>已筛选：</Text>
          {chips.map((chip) => (
            <Tag key={chip.key} closable onClose={(event) => { event.preventDefault(); chip.remove(); }} style={{ marginInlineEnd: 0 }}>
              {chip.text}
            </Tag>
          ))}
          {hasActiveFilters(filters) ? (
            <Button size="small" type="link" onClick={() => onChange({ ...EMPTY_FILTERS, tab: filters.tab })}>清空</Button>
          ) : null}
        </Space>
      ) : null}
    </div>
  );
}
