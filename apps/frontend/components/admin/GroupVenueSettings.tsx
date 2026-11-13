'use client';

import { useState } from 'react';
import { Alert, Button, Input, Modal, Select, Space, Table, Tag, Typography, message } from 'antd';
import { apiFetch } from '@/lib/api';

export type VenueRuleMode = 'INHERIT' | 'ALL' | 'SPECIFIED';

export type EventVenueRule = {
  eventId: string;
  type: string;
  name: string;
  venueRule: VenueRuleMode;
  venueIds: string[];
};

export type GroupVenueRule = {
  groupId: string;
  name: string;
  restrictVenues: boolean;
  venueIds: string[];
  /** 本组比赛日期（YYYY-MM-DD），空为不限。 */
  playDates?: string[];
  events?: EventVenueRule[];
};
type Venue = { id: string; name: string; isActive: boolean };

const RULE_OPTIONS = [
  { value: 'INHERIT', label: '继承组别' },
  { value: 'ALL', label: '不限制' },
  { value: 'SPECIFIED', label: '指定场地' },
];

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/** 2026-11-15 → 11月15日 周六 */
export function playDayLabel(day: string) {
  const [year, month, date] = day.split('-').map(Number);
  return `${month}月${date}日 ${WEEKDAYS[new Date(Date.UTC(year, month - 1, date)).getUTCDay()]}`;
}

/** 组别比赛日期的文字说明，空为「不限」。 */
export function playDaysText(days?: string[] | null) {
  return days?.length ? days.map(playDayLabel).join('、') : '不限';
}

export function GroupVenueSettings({ tournamentId, token, groups, venues, days, onSaved }: {
  tournamentId: string; token: string; groups: GroupVenueRule[]; venues: Venue[];
  /** 赛事开始到结束的每一天，比赛日期只能从这里选。 */
  days: string[];
  onSaved: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<GroupVenueRule[]>([]);
  const [selected, setSelected] = useState<React.Key[]>([]);
  const [search, setSearch] = useState('');
  const [batch, setBatch] = useState<string[]>([]);
  const [batchDays, setBatchDays] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const options = venues.map(v => ({ value: v.id, label: `${v.name}${v.isActive ? '' : '（停用，请重新选择）'}`, disabled: !v.isActive }));
  const dayOptions = days.map(day => ({ value: day, label: playDayLabel(day) }));
  // 赛事日期改过以后，原来选的日子可能已不在赛事日期内，标红让管理员重新选。
  const staleDays = (row: GroupVenueRule) => (row.playDates ?? []).filter(day => !days.includes(day));
  const venueNames = (ids: string[]) => ids.map(id => venues.find(v => v.id === id)?.name ?? '已删除').join('、');

  const update = (id: string, change: Partial<GroupVenueRule>) => setRows(current => current.map(r => r.groupId === id ? { ...r, ...change } : r));
  const updateEvent = (groupId: string, eventId: string, change: Partial<EventVenueRule>) => setRows(current => current.map(row => row.groupId === groupId
    ? { ...row, events: (row.events ?? []).map(event => event.eventId === eventId ? { ...event, ...change } : event) }
    : row));

  // 单项「继承组别」时展示组别实际生效的场地，避免看不到最终结果。
  const inheritedText = (group: GroupVenueRule) => group.restrictVenues
    ? `跟随组别：${group.venueIds.length ? venueNames(group.venueIds) : '未选择场地'}`
    : '跟随组别：全部启用场地';

  async function save() {
    if (rows.some(r => r.restrictVenues && !r.venueIds.length)) { message.error('指定场地的组别至少选择一片场地'); return; }
    const events = rows.flatMap(r => r.events ?? []);
    if (events.some(e => e.venueRule === 'SPECIFIED' && !e.venueIds.length)) { message.error('指定场地的单项至少选择一片场地'); return; }
    const stale = rows.find(r => staleDays(r).length);
    if (stale) { message.error(`「${stale.name}」的比赛日期有不在赛事日期内的日子，请重新选择`); return; }
    setSaving(true);
    try {
      const result = await apiFetch<{ affectedMatchCount: number }>(`/tournaments/${tournamentId}/group-venues`, {
        method: 'PATCH', token, body: JSON.stringify({
          groups: rows.map(({ groupId, restrictVenues, venueIds, playDates }) => ({ groupId, restrictVenues, venueIds: restrictVenues ? venueIds : [], playDates: playDates ?? [] })),
          events: events.map(({ eventId, venueRule, venueIds }) => ({ eventId, venueRule, venueIds: venueRule === 'SPECIFIED' ? venueIds : [] })),
        }),
      });
      await onSaved(); setOpen(false);
      Modal.info({ title: '场地与日期规则已保存', okText: '知道了', content: result.affectedMatchCount
        ? `有 ${result.affectedMatchCount} 场未开始比赛的场地或日期不符合新规则，赛程表里标了「需调场」或「需改期」。请预览并应用自动排程，或手动调整；大屏在实际排程保存后更新。`
        : '规则将在下次排程时使用。当前比赛安排保持不变。' });
    } catch (e) { message.error(e instanceof Error ? e.message : '保存失败'); }
    finally { setSaving(false); }
  }

  return <>
    <Button disabled={!tournamentId} onClick={() => {
      setRows(groups.map(r => ({ ...r, venueIds: [...r.venueIds], playDates: [...(r.playDates ?? [])], events: (r.events ?? []).map(e => ({ ...e, venueIds: [...e.venueIds] })) })));
      setSelected([]); setSearch(''); setBatch([]); setBatchDays([]); setOpen(true);
    }}>组别场地与日期</Button>
    <Modal title="组别场地与日期" open={open} onCancel={() => setOpen(false)} onOk={save} confirmLoading={saving} width={1120} okText="保存规则" cancelText="取消">
      <Alert type="info" showIcon title="场地可精确到单项：展开组别即可为男子单打、女子双打等单独指定场地。单项默认继承组别；不限制表示忽略组别限制、使用全部启用场地。比赛日期按组别设置，可选一天或几天：自动排程只把本组比赛排在这几天，不选为不限。" style={{ marginBottom: 16 }} />
      <Space wrap style={{ marginBottom: 8 }}>
        <Input.Search placeholder="搜索组别或单项" value={search} onChange={e => setSearch(e.target.value)} style={{ width: 200 }} />
        <Select mode="multiple" placeholder="批量选择场地" value={batch} onChange={setBatch} options={options} style={{ minWidth: 220 }} />
        <Button disabled={!selected.length || !batch.length} onClick={() => setRows(current => current.map(r => selected.includes(r.groupId) ? { ...r, restrictVenues: true, venueIds: batch } : r))}>场地应用于所选组别</Button>
        <Button disabled={!selected.length} onClick={() => setRows(current => current.map(r => selected.includes(r.groupId) ? { ...r, restrictVenues: false, venueIds: [] } : r))}>场地恢复不限制</Button>
      </Space>
      <Space wrap style={{ marginBottom: 12 }}>
        <Select mode="multiple" allowClear placeholder="批量选择比赛日期（不选为不限）" value={batchDays} onChange={setBatchDays} options={dayOptions} maxTagCount="responsive" style={{ minWidth: 300 }} />
        <Button disabled={!selected.length} onClick={() => setRows(current => current.map(r => selected.includes(r.groupId) ? { ...r, playDates: [...batchDays].sort() } : r))}>日期应用于所选组别</Button>
      </Space>
      <Table
        rowKey="groupId"
        dataSource={rows.filter(r => !search || r.name.toLowerCase().includes(search.toLowerCase()) || (r.events ?? []).some(e => e.name.includes(search)))}
        pagination={{ pageSize: 10 }}
        rowSelection={{ selectedRowKeys: selected, onChange: setSelected, preserveSelectedRowKeys: true }}
        expandable={{
          expandedRowRender: (row) => (row.events?.length
            ? <Table
              rowKey="eventId"
              size="small"
              pagination={false}
              dataSource={row.events}
              columns={[
                { title: '单项', dataIndex: 'name', width: 140 },
                {
                  title: '场地规则', width: 170,
                  render: (_, event) => <Select
                    value={event.venueRule}
                    style={{ width: 140 }}
                    options={RULE_OPTIONS}
                    onChange={(venueRule: VenueRuleMode) => updateEvent(row.groupId, event.eventId, { venueRule, ...(venueRule === 'SPECIFIED' ? {} : { venueIds: [] }) })}
                  />,
                },
                {
                  title: '可用场地',
                  render: (_, event) => {
                    if (event.venueRule === 'SPECIFIED') {
                      return <Select mode="multiple" value={event.venueIds} onChange={venueIds => updateEvent(row.groupId, event.eventId, { venueIds })} options={options} placeholder="至少选择一片场地" style={{ width: '100%' }} />;
                    }
                    return <Typography.Text type={event.venueRule === 'ALL' ? 'secondary' : undefined}>{event.venueRule === 'ALL' ? '全部启用场地（忽略组别限制）' : inheritedText(row)}</Typography.Text>;
                  },
                },
              ]}
            />
            : <Typography.Text type="secondary">该组别暂无单项，请先在赛事配置中创建。</Typography.Text>),
          rowExpandable: (row) => Boolean(row.events?.length),
        }}
        columns={[
          { title: '组别', dataIndex: 'name', width: 170 },
          {
            title: '组别场地模式', width: 170,
            render: (_, row) => <Select value={row.restrictVenues ? 'specified' : 'all'} style={{ width: 140 }} options={[{ value: 'all', label: '不限制' }, { value: 'specified', label: '指定场地' }]} onChange={mode => update(row.groupId, { restrictVenues: mode === 'specified', ...(mode === 'specified' ? {} : { venueIds: [] }) })} />,
          },
          {
            title: '组别可用场地',
            render: (_, row) => (row.restrictVenues
              ? <Select mode="multiple" value={row.venueIds} onChange={venueIds => update(row.groupId, { venueIds })} options={options} placeholder="至少选择一片场地" style={{ width: '100%' }} />
              : '全部启用场地'),
          },
          {
            title: '比赛日期', width: 250,
            render: (_, row) => {
              // 不在赛事日期内的旧日子也要能看到、能删掉。
              const stale = staleDays(row);
              return <Select
                mode="multiple"
                allowClear
                placeholder="不限"
                value={row.playDates ?? []}
                status={stale.length ? 'error' : undefined}
                maxTagCount="responsive"
                options={[...dayOptions, ...stale.map(day => ({ value: day, label: `${playDayLabel(day)}（不在赛事日期内）` }))]}
                onChange={(playDates: string[]) => update(row.groupId, { playDates: [...playDates].sort() })}
                style={{ width: '100%' }}
              />;
            },
          },
          {
            title: '单项覆盖', width: 130,
            render: (_, row) => {
              const overridden = (row.events ?? []).filter(e => e.venueRule !== 'INHERIT').length;
              return overridden ? <Tag color="blue">{overridden} 个单项单独设置</Tag> : <Typography.Text type="secondary">全部继承组别</Typography.Text>;
            },
          },
        ]}
      />
    </Modal>
  </>;
}
